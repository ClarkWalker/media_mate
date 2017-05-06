/**
 * @author William Blythe
 * @fileoverview File that handles downloading of shows
 */
/**
 * @module Downloader
 */
/* eslint-disable no-unused-vars */
/* eslint-disable max-nested-callbacks */
require('dotenv').config({path: `${__dirname}/.env`});
const {dialog} = require('electron').remote;
const path = require('path');
const bugsnag = require('bugsnag');
const ipc = require('electron').ipcRenderer;
const PouchDB = require('pouchdb');
require('events').EventEmitter.prototype._maxListeners = 1000;
const moment = require('moment');
const swal = require('sweetalert2');
const RSSParse = require(`${__dirname}/../lib/rssparse.js`).RSSParse;
const ProgressBar = require('progressbar.js');
const _ = require('underscore');
const storage = require('electron-json-storage');
const WebTorrent = require('webtorrent');

const rssTor = [];
let dupeCount = 0;
let db;
PouchDB.plugin(require('pouchdb-find'));
const version = require('electron').remote.app.getVersion();
bugsnag.register('03b389d77abc2d10136d8c859391f952', {appVersion: version, sendCode: true});
const client = new WebTorrent();
let i = 0;
let bar;
const dbindex = 0;
const allTorrents = [];
const prog = _.throttle(dlProgress, 10000);

process.on('unhandledRejection', (err, promise) => {
	console.error('Unhandled rejection: ' + (err && err.stack || err)); // eslint-disable-line
	bugsnag.notify(new Error(err));
});

function handleErrs(err) {
	console.error('Unhandled rejection: ' + (err && err.stack || err)); // eslint-disable-line
	bugsnag.notify(new Error(err));
}

/**
 * Make sure that everything is loaded before doing the good stuff.
 */
window.onload = () => {
	findDocuments();
	indexDB();
	getRSSURI(callback => {
		document.getElementById('rss').value = callback;
	});
	bar = new ProgressBar.Line('#Progress', {
		strokeWidth: 4,
		easing: 'easeInOut',
		duration: 1400,
		color: '#FFEA82',
		trailColor: '#eee',
		trailWidth: 1,
		svgStyle: {
			width: '100%',
			height: '100%'
		},
		text: {
			style: {
				// Text color.
				// Default: same as stroke color (options.color)
				color: '#999',
				position: 'absolute',
				right: '0',
				//				Top: '30px',
				padding: 0,
				margin: 0,
				transform: null
			},
			autoStyleContainer: false
		},
		from: {
			color: '#FFEA82'
		},
		to: {
			color: '#ED6A5A'
		},
		step: (state, bar) => {
			bar.setText(Math.round(bar.value() * 100) + ' %');
		}
	});
};
/**
 * Update the download progress bar, but make sure not to do it too often.
 */
function dlProgress() {
	const animateThrottled = _.throttle(
		_.bind(bar.animate, bar),
		500
	);
	animateThrottled(client.progress);
}
/**
 * WebTorrent on error, handle it.
 */
client.on('error', err => {
	handleErrs(err);
});
/**
 * Get the ShowRSS URI from JSON storage
 * @param callback - return it.
 */
function getRSSURI(callback) {
	storage.get('showRSS', (err, data) => {
		if (err) {
			handleErrs(err);
		}
		if (_.isEmpty(data) === false) {
			callback(data.showRSSURI);
		} else {
			callback('');
		}
	});
}
/**
 * Make sure not to add torrents already downloaded.
 * @param torrent {object} - the torrent object to be checked
 * @param callback - You know what it is.
 */
function ignoreDupeTorrents(torrent, inDB, callback) {
	const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbTor').toString());
	if (inDB === false) {
		db.find({
			selector: {
				_id: torrent.link || torrent.magnet
			},
			fields: ['_id', 'magnet', 'downloaded']
		}).then(res => {
			if (res.docs.length > 0) {
				if (res.docs[0].downloaded === true) {
					callback('dupe');
				} else if (res.docs[0].downloaded === false) {
					callback();
				}
			} else {
				db.put({
					_id: torrent.link,
					magnet: torrent.link,
					title: torrent.title,
					tvdbID: torrent['tv:show_name']['#'] || torrent.tvdbID,
					airdate: torrent['rss:pubdate']['#'] || torrent.airdate,
					downloaded: false
				}).then(res => {
					callback();
				}).catch(err => {
					handleErrs(err);
				});
			}
		}).catch(err => {
			handleErrs(err);
		});
	} else {
		callback();
	}
}
/**
 * Drop the torrent database. Mainly for testing purpose.
 * @param callback - let em know.
 */
function dropTorrents(callback) {
	const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbTor').toString());
	db.allDocs({
		include_docs: true, // eslint-disable-line camelcase
		attachments: true
	}).then(res => {
		_.each(res.rows, elem => {
			if (elem.doc._id !== 'showRSS') {
				db.remove(elem.doc);
			}
		});
	}).catch(err => {
		console.log(err);
	});
}
/**
 * Make sure that the ShowRSS URI is updated.
 * @param uri {string} - the ShowRSS URI
 */
function updateURI(uri) {
	storage.set('showRSS', {showRSSURI: uri}, err => {
		if (err) {
			throw err;
		}
	});
}
/**
 * Initial load, get the torrents in the db.
 */
function findDocuments() {
	const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbTor').toString());
	db.allDocs({
		include_docs: true // eslint-disable-line camelcase
	}).then(result => {
		_.each(result.rows, elem => allTorrents.push(elem.doc.magnet));
		db.close();
	}).catch(err => {
		console.log(err);
	});
}

function indexDB() {
	const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbTor').toString());
	db.createIndex({
		index: {
			fields: ['_id', 'magnet', 'downloaded']
		}
	}).then(result => {
		if (result.result === 'created') {
			console.log('index made');
		} else {
			console.log('already exists');
		}
	}).catch(err => {
		handleErrs(err);
	});
}

/**
 * Download all of the torrents, after they are added to the DOM.
 */
function dlAll() {
	const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbTor').toString());
	db.find({
		selector: {downloaded: false},
		fields: ['_id', 'magnet', 'title', 'airdate', 'downloaded']
	}).then(result => {
		_.each(result.docs, (elem, index) => {
			addTor(elem.magnet, index);
		});
		db.close();
	}).catch(err => {
		handleErrs(err);
	});
}
/**
 * Get the path for torrents to be downloaded to, from JSON storage.
 * @param callback
 */
function getDlPath(callback) {
	storage.get('path', (err, data) => {
		if (err) {
			handleErrs(err);
		}
		if (_.isEmpty(data) === false) {
			callback(data.path);
		} else {
			callback('');
		}
	});
}
/**
 * Insert the download path to electron-json-storage
 * @param callback - callback, obviously
 */
function insertDlPath(callback) {
	const tb = document.getElementById('dlpath');
	dialog.showOpenDialog({
		properties: ['openDirectory']
	}, dlpath => {
		if (dlpath !== undefined) {
			console.log(dlpath[0]);
			storage.set('path', {
				path: dlpath[0]
			}, error => {
				if (error) {
					handleErrs(error);
				}
			});
		}
	});
}
/**
 * Add a torrent to WebTorrent and the DB.
 * @param magnet {string} - the magnet URI for WebTorrent
 * @param index {number} - the index of the torrent.
 */
function addTor(magnet, index) {
	document.getElementById('Progress').style.display = '';
	getDlPath(callback => {
		client.add(magnet, {
			path: callback
		}, torrent => {
			torrent.index = index;
			document.getElementsByName(magnet)[0].checked = true;
			document.getElementsByName(magnet)[0].disabled = true;
			torrent.on('download', () => {
				prog(torrent, magnet);
				const percent = Math.round(torrent.progress * 100 * 100) / 100;
				document.getElementsByName(magnet)[0].parentNode.childNodes[1].nodeValue = `- ${percent.toString()}% downloaded, ${moment.duration(torrent.timeRemaining / 1000, 'seconds').humanize()} remaining.`;
			});
			torrent.on('done', () => {
				dlProgress();
				const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbTor').toString());
				db.get(document.getElementsByName(magnet)[0].name).then(doc => {
					db.put({
						_id: document.getElementsByName(magnet)[0].name,
						_rev: doc._rev,
						magnet: document.getElementsByName(magnet)[0].name,
						downloaded: true,
						title: doc.title,
						tvdbID: doc.tvdbID,
						airdate: doc.airdate
					}).then(res => {
						document.getElementsByName(magnet)[0].parentNode.style.display = 'none';
						console.log('done');
						ipc.send('dldone', torrent.name);
						torrent.destroy();
					}).catch(err => {
						handleErrs(err);
					});
				});
			});
		});
	});
}

/**
 * Function to process torrents from ShowRSS
 * @param {object} data
 * @param {boolean} inDB
 */
function processTorrents(data, inDB) {
	const dlbox = document.getElementById('dlbox');
	ignoreDupeTorrents(data, inDB, dupe => {
		if (!dupe) {
			const br = document.createElement('br');
			const label = document.createElement('label');
			label.innerText = `${data.title} - (${moment(data.pubdate).fromNow()}) `;
			const input = document.createElement('input');
			const dlprogTitle = document.createTextNode(' ');
			label.appendChild(dlprogTitle);
			label.id = i;
			input.type = 'checkbox';
			input.className = 'checkbox';
			input.name = data.link;
			input.addEventListener('click', () => {
				input.disabled = true;
				input.className = 'is-disabled';
				addTor(input.name, parseInt(input.id, 0));
			});
			label.appendChild(input);
			dlbox.appendChild(document.createElement('br'));
			document.getElementById('dlbox').appendChild(label);
			document.getElementById('dlAll').style.display = 'block';
			i++;
		} else if (dupe) {
			console.log('dupe');
			dupeCount++;
			console.log(dupeCount);
			document.getElementById('dupecount').style.display = '';
			document.getElementById('dupecount').textContent = `${dupeCount} dupes`;
		}
	});
}

/**
 * Called on hitting enter in the Magnet URI box.
 * @param e {object} - the keypress event.
 * @returns {boolean} - whether the key was enter or not.
 */
function runScript(e) {
	if (e.keyCode === 13) {
		const tb = document.getElementById('rss');
		swal(
			'Getting your downloads',
			'Welcome to Media Mate',
			'success'
		);
		// Use connect method to connect to the Server
		updateURI(tb.value);
		document.getElementById('dls').style.display = 'inline';
		const RSS = new RSSParse(tb.value);
		RSS.on('error', err => {
			console.log(err);
		});
		RSS.on('data', data => {
			data = _.omit(data, '_id');
			rssTor.push(data);
			processTorrents(data, false);
		});
		return false;
	}
}
