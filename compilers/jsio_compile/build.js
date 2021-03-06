#!/usr/local/bin/node

// run "node build.js" to generate a self-contained jsio_compile script

var sys = require('sys'),
	fs = require('fs'),
	path = require('path'),
	node = process.argv[0];

var exec = require('child_process').exec;

var BUILD_DIR = 'build';
var TARGET = path.join(BUILD_DIR, 'jsio_compile');
var CACHE_PATH = path.join(BUILD_DIR, '.cache');

require('./jsio/jsio');

// setup logging
jsio('from base import *');
logger = logging.get('compiler');
logging.get('preprocessors.compiler').setLevel(0);

jsio('import lib.Callback');
var cb = new lib.Callback();

exec('mkdir -p ' + BUILD_DIR, null, cb.chain());
exec('mkdir -p ' + CACHE_PATH, null, cb.chain());

cb.run(doCompile);

function doCompile() {
	// get access to jsio path util functions
	jsio('import util.path');

	var compiler = jsio('import preprocessors.compiler');

	var interface = jsio('import .node_interface');
	interface.logger.setLevel(0);

	compiler.setCompressor(interface.compressor);

	compiler.compile('import preprocessors.compiler');
	compiler.compile('import .compiler', {
		dynamicImports: {
			COMPILER: 'import .node_interface'
		}
	});

	// grab a full copy of jsio
	walk('jsio', function(path, files, dirs) {
		files.forEach(function(file) {
			if (/\.js$/.test(file)) {
				var module = file.replace(/^jsio\//, '').replace(/\.js$/, '').replace(/\//g, '.');
				if (module != 'jsio') {
					compiler.compile('import ' + module);
				}
			}
		});
	});

	exec("which " + node, function(error, stdout, stderr) {
		var nodeLocation = stdout.replace(/\n/g, '');
		logger.info('Found node at', nodeLocation)
		exec(nodeLocation + " --version", function(error, stdout, stderr) {
			var nodeVersion = stdout.replace(/\n/g, '');;
			logger.info('Using node version', nodeVersion);
			compiler.generateSrc({compressorCachePath: CACHE_PATH, compressSources: true, compressResult: true, preserveJsioSource: true}, function(src) {
				var fd = fs.openSync(TARGET, 'w');
				fs.writeSync(fd, '#!' + nodeLocation + '\n');
				fs.writeSync(fd, src);
				fs.writeSync(fd, 'jsio("import .compiler").start()');
				fs.closeSync(fd);

				exec("chmod +x " + TARGET);
				logger.info('Wrote', TARGET);
			});
		});
	});
}

// ********
// node-specific walk implementation

function walk(path, callback) {
	var stat = fs.statSync(path);
	
	if (!stat.isDirectory()) { throw new Error('walk: ' + path + ' is not a directory'); }

	var files = fs.readdirSync(path),
		items = {files: [], dirs: []};
	
	files.forEach(function(name) {
		var absPath = util.path.join(path, name);
		if (fs.statSync(absPath).isDirectory()) {
			if (walk(absPath, callback) == true) { return false; }
			items.dirs.push(absPath);
		} else {
			items.files.push(absPath);
		}
	});
	
	return callback(path, items.files, items.dirs);
}

