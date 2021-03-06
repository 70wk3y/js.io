jsio('from base import *');
var logger = logging.get('jsio_compiler');

var JSIO = 'jsio';

var supportedEnvs = {
	node: true,
	browser: true
};

var _interface = null;

exports.start = function(/*optional*/ args, opts) {
	if (!jsio.__env.name in supportedEnvs) {
		logger.error("autostart failed: unknown environment.\n\n\tTry using compiler.run(args, opts) instead.");
		return;
	}
	
	var DYNAMIC_IMPORT_COMPILER = 'import .' + jsio.__env.name + '_interface';
	
	_interface = jsio(DYNAMIC_IMPORT_COMPILER);
	
	// expects the interface to eventually call startWithOpts to do the actual compile
	_interface.init(exports, args, opts);
}

function getPackage(fileName) {
	try {
		var pkg = eval('(' + jsio.__env.fetch(fileName) + ')');
		logger.info('Package definition loaded from', fileName);
		return pkg;
	} catch(e) {
		logger.log(jsio.__env.getCwd())
		logger.warn('If "' + fileName + '" is a package file, it could not be read.', e);
	}
	return false;
}

exports.setDebugLevel = function(level) {
	logger.setLevel(level);
	_interface.logger.setLevel(level);
}

/**
 * args : array of arguments
 *   - args[0] : string - initial import string (optional if opts.package is provided)
 * opts : see optsDef.js
 *   - package : string - filename of a package definition
 *   - debug : integer - debug level (1 - 5)
 */
exports.run = function(args, opts) {
	
	var debugLevel = 'debug' in opts ? opts.debug : 5;
	exports.setDebugLevel(debugLevel);
	
	if (debugLevel >= 3) {
		var strOpts = JSON.stringify(opts, null, '\t');
		logger.info('Starting compiler with args: ', args, 'and options:', strOpts.substring(1, strOpts.length - 1));
	}
	
	// use external copy of jsio rather than cached copy
	if (opts.jsioPath) {
		// force the path
		jsio.path.set([opts.jsioPath]);
		
		// hack to 'set' the js.io source code
		jsio.__jsio.__init__.toString = function() { return jsio.__env.fetch(jsio.__jsio.__util.buildPath(opts.jsioPath, 'jsio.js')); }
		
		// reset cached path
		for (var key in jsio.path.cache) {
			delete jsio.path.cache[key];
		}
		
		// delete the cache copy
		var sourceCache = jsio.__jsio.__srcCache;
		for (var i in sourceCache) {
			delete sourceCache[i];
		}
	}
	
	if (opts.path) {
		for(var i = 0, len = opts.path.length; i < len; ++i) {
			if (opts.path[i]) {
				jsio.path.add(opts.path[i]);
			}
		}
	}
	
	logger.info('js.io path:', JSON.stringify(jsio.path.get()));
	
	var initial;
	
	// -- parse options --
	// try to maintain consistency with pyjsiocompile
	
	// accept a pkg file as the first argument
	if (/\.pkg$/.test(args[2])) {
		var pkg = getPackage(args[2]);

		// was it a valid pkg file?
		// (our test would also return true for "import foo.bar.pkg")
		if (pkg != false) {
			args.splice(2, 1); // consume the argument
			opts['package'] = pkg; // treat the package the same as if it was specified on the command line
		}
	}
	
	// opts.package is probably the filename of the package
	if (typeof opts['package'] == 'string' && /\.pkg$/.test(opts['package'])) {
		opts['package'] = getPackage(opts['package']);
	} 

	// parse the package contents
	if (opts['package']) {
		var pkgDef = opts['package'];
		
		logger.debug(pkgDef);
		
		// in pyjsiocompile, root does two things:
		if ('root' in pkgDef) {
			// 1. provide the initial import
			initial = pkgDef.root;

			// pyjsiocompile package files don't have a relative import indicator (a prefix dot: '.')
			// to indicate that the first import is relative, so manually add one here
			if (!/^\./.test(initial)) { initial = '.' + initial; }
			
			// 2. generate a statement to include at the bottom of the file
			opts.appendImport = true;
		}
	

		// pyjsiocompile has keys for building the dynamic import ENV for the jsio net module.
		// All pairs of (environment, transport) should be included as dependencies.
		
		function extendArray(destKey, srcKey) {
			opts[destKey] = (opts[destKey] || []).concat(pkgDef[srcKey || destKey]);
		}
		
		function extendObject(destKey, srcKey) {
			opts[destKey] = JS.merge((opts[destKey] || {}), pkgDef[srcKey || destKey]);
		}
		
		if (pkgDef.environments) { extendArray('environments'); }
		if (pkgDef.transports) { extendArray('transports'); }
		
		// pyjsiocompile never supported additional dependencies, but the package files
		// have an empty key, so let's implement it anyway
		if (pkgDef.additional_dependancies) { extendArray('additionalDeps', 'additional_dependancies'); }

		// introduce new key 'dynamicImports' for handling dynamic import resolution
		//  -> a statement of jsio(DYNAMIC_IMPORT_foo) looks up 'foo' in the dynamicImports
		//     dictionary (each key maps to a string or array of strings)
		if (pkgDef.dynamicImports) { extendObject('dynamicImports'); }
	}
	
	// default argument is an import statement:
	//    jsio_compile "import .myModule"
	// (this will be args[2])
	// We do this after package resolution since the arguments on the
	// command-line should override any settings in the package file.
	if (args.length > 2) { initial = args[2]; }
	
	if (!initial) {
		_interface.onError('No initial import specified');
		return;
	}
	
	// pyjsiocompile built the dynamic import table for the net environment
	// which depends on runtime environment and desired transports.  This
	// code does the same thing, building a list of imports that need to
	// happen upon import of the net.env module.  
	logger.info('dynamic imports: ', opts.dynamicImports);
	if (!opts.dynamicImports) { opts.dynamicImports = {}; }
	if (!opts.dynamicImports.ENV) { opts.dynamicImports.ENV = null; }
	if (opts.transports && opts.environments) {
		var ENV = opts.dynamicImports.ENV = opts.dynamicImports.ENV || [];
		for (var i = 0, numT = opts.transports.length; i < numT; ++i) {
			for (var j = 0, numE = opts.environments.length; j < numE; ++j) {
				opts.dynamicImports.ENV.push('import net.env.' + opts.environments[j] + '.' + opts.transports[i]);
			}
		}
	}
	
	var result = initial.match(/^(.*)\.js$/);
	if (result) {
		initial = result[1];
		if (initial.charAt[0] != '/' && initial.charAt[0] != '.') {
			initial = './' + initial;
		}
	}
	
	// run the actual compiler
	var compiler = jsio('import preprocessors.compiler');
	
	compiler.setDebugLevel(debugLevel);
	
	if (opts.compressor) { compiler.setCompressor(opts.compressor); }
	
	compiler.compile('import base');
	
	if (opts.additionalDeps) {
		var deps = opts.additionalDeps,
			n = deps.length;
		logger.info('compiling dependencies...');
		for (var i = 0; i < n; ++i) {
			compiler.compile(deps[i]);
		}
	}
	
	var compileOpts = {
		autoDetectPaths: true,
		dynamicImports: opts.dynamicImports
	};
	
	logger.info('compiling main program', initial, JSON.stringify(compileOpts));
	compiler.compile(initial, compileOpts);
	
	compiler.generateSrc(opts, function(src) {
		if (opts.appendImport) {
			src = src + JSIO + '("' + initial + '")';
		}
		
		if (opts.footer) {
			src = src + (opts.footer || '');
		}
		
		_interface.onFinish(opts, src);
	});
}

