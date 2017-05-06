/**
 * @author William Blythe
 * @fileoverview File that allows for streaming media
 */
/**
 * @module Streamer
 */
/* eslint-disable no-unused-vars */
const WebTorrent = require('webtorrent');
require('dotenv').config();
require('events').EventEmitter.prototype._maxListeners = 1000;
const swal = require('sweetalert2');
const path = require('path');
const _ = require('underscore');
const PouchDB = require('pouchdb');
const {isPlayable, titleCase} = require(require('path').join(__dirname, '..', 'lib', 'utils.js'));

PouchDB.plugin(require('pouchdb-upsert'));
PouchDB.plugin(require('pouchdb-find'));
const client = new WebTorrent();
let filesAll;

client.on('error', err => {
	console.log(err);
});

/**
 * On keypress on the input
 * @param e {object} - the event
 * @returns {boolean} - whether enter was pressed or not.
 */
function runScript(e) {
	if (e.keyCode === 13) {
		swal(
			'Getting your stream ready.',
			'Welcome to Media Mate',
			'success'
		);
		const tb = document.getElementById('magnet');
		submitmagnet(tb.value);
		return false;
	}
}
/**
 * Called on window load.
 */
window.onload = () => {
	streamHistory();
};

/**
 * Allow the user to choose what file to stream.
 * @param files {array} - files in the torrent
 */
function chooseFile(files) {
	const select = document.getElementById('selectFile');
	console.log(files);
	files = _.filter(files, isPlayable);
	filesAll = files;
	for (let i = 0; i < files.length; i++) {
		const opt = files[i];
		const el = document.createElement('option');
		el.textContent = opt.name;
		el.value = i;
		select.appendChild(el);
	}
}
/**
 * Start playing the file
 * @param file {object} - the file
 */
function startPlaying(file) {
	file.appendTo('#player', (err, elem) => {
		if (err) {
			throw err;
		} // File failed to download or display in the DOM
		console.log('New DOM node with the content', elem);
		elem.style.display = 'block';
		elem.style.width = '100%';
		document.getElementById('destroy').style.display = 'block';
		file.getBlobURL((err, url) => {
			if (err) {
				throw err;
			}
			const a = document.createElement('a');
			a.download = file.name;
			a.href = url;
			a.textContent = 'Download ' + file.name;
			console.log(a);
			document.getElementById('dl').appendChild(a);
		});
	}); // Append the file to the DOM
}
/**
 * Get file when selected
 */
function getFile() {
	const e = document.getElementById('selectFile');
	const text = e.options[e.selectedIndex].value;
	startPlaying(filesAll[text]);
}
/**
 * Add magnet to WebTorrent
 * @param magnet {string} - the magnet URI
 */
function submitmagnet(magnet) {
	const ifExist = client.get(magnet);
	if (ifExist) {
		addStreamHistory(ifExist);
		process.torrent = ifExist;
		document.getElementById('files').style.display = 'inline';
	} else {
		client.add(magnet, torrent => {
			addStreamHistory(torrent);
			chooseFile(torrent.files);
			process.torrent = torrent;
			document.getElementById('files').style.display = 'inline';
		});
	}
}
/**
 * Adds torrents to stream history DB.
 * @param torrent {object} Contains magnet, files, metadata etc.
 */
function addStreamHistory(torrent) {
	const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbStream').toString());
	let files = [];
	_.each(torrent.files, file => {
		files.push(file.name);
	});
	files = _.filter(files, isPlayable);
	console.log(files);
	db.putIfNotExists(torrent.magnetURI, {magnet: torrent.magnetURI, files: files})
		.then(res => {
			console.log(res);
		})
		.catch(err => {
			if (err.status !== 404) {
				throw err;
			}
		});
}
/**
 * Called when choosing a file in the history form.
 */
function getFileHistory() {
	const e = document.getElementById('historySelect');
	const text = e.options[e.selectedIndex];
	submitmagnet(text.id);
}
/**
 * Get stream history, and make options in a select tag.
 * Called on window load.
 */
function streamHistory() {
	const db = new PouchDB(require('path').join(require('electron').remote.app.getPath('userData'), 'dbStream').toString());
	const select = document.getElementById('historySelect');
	db.allDocs({include_docs: true}) // eslint-disable-line camelcase
		.then(res => {
			for (let i = 0; i < res.rows.length; i++) {
				_.each(res.rows[i].doc.files, file => {
					const opt = file;
					const el = document.createElement('option');
					el.textContent = opt;
					el.value = i;
					el.id = res.rows[i].doc.magnet;
					select.appendChild(el);
				});
				document.getElementById('historyForm').style.display = 'inline-block';
			}
		})
		.catch(err => {
			throw err;
		});
}

/**
 * Stop downloading the torrent.
 */
function stop() {
	process.torrent.destroy(tor => {
		document.getElementById('player').removeChild(document.getElementById('player').firstChild);
		document.getElementById('destroy').style.display = 'none';
		document.getElementById('selectFile').style.display = 'none';
	});
}
