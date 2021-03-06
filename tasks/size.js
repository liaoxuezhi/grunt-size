module.exports = function(grunt) {

    var file = grunt.file,
        q = require('q'),
        fs = require('fs'),
        path = require('path'),
        zlib = require( 'zlib' ),
        uglify = require('uglify-js'),
        sprintf = require('./lib/sprintf'),
        Tempfile = require('temporary/lib/file'),

        handler = {
            filepath: function( filepath, dir ) {
                dir = dir || '';
                
                return filepath;
            },

            origin: function( filepath, dir ) {
                dir = dir || '';

                return beatifySize(fs.statSync(dir + filepath).size);
            },

            uglify_gzip: function( filepath, dir ) {
                dir = dir || '';

                var content = uglify.minify( dir + filepath ).code,
                    tmpfile = new Tempfile(),
                    size;

                file.write( tmpfile.path, content );
                return this.gzip( tmpfile.path )
                        .then( function( value ) {
                            tmpfile.unlink();
                            return value;
                        });
            },

            removecomments: function(filepath, dir) {
                dir = dir || '';

                var content = file.read(dir + filepath),
                    tmpfile = new Tempfile(),
                    size;

                file.write(tmpfile.path, removeComments(content));

                size = fs.statSync(tmpfile.path).size;

                tmpfile.unlink();

                return beatifySize(size);
            },

            uglify: function(filepath, dir) {
                dir = dir || '';

                var content = uglify.minify(dir + filepath).code,
                    tmpfile = new Tempfile(),
                    size;

                file.write(tmpfile.path, content);
                size = fs.statSync(tmpfile.path).size;
                tmpfile.unlink();

                return beatifySize(size);
            },

            gzip: function(filepath, dir) {
                dir = dir || '';

                var me = this,
                    deferred = q.defer(),
                    gzip = zlib.createGzip(),
                    tmpfile = new Tempfile(),
                    inp = fs.createReadStream( dir + filepath ),
                    out = fs.createWriteStream( tmpfile.path );

                out.on( 'close', function() {
                    var value = me.origin( tmpfile.path );
                    tmpfile.unlink();
                    deferred.resolve( value );
                } );
                inp.pipe( gzip ).pipe( out );

                return deferred.promise;
            }
        },

        header = {
            'filepath': 'File Path',
            'origin': 'Original',
            'removecomments': 'Remove Comments',
            'uglify': 'Uglify',
            'gzip': 'Gzip',
            'uglify_gzip': 'Uglify & Gzip'
        };


    function beatifySize(size) {
        var units = ['B', 'KB', 'MB', 'TB'],
            unit = units.shift();

        while (size > 1024 && units.length) {
            unit = units.shift();
            size = size / 1024;
        }

        return (unit === 'B' ? size : size.toFixed(2)) + ' ' + unit;
    }

    function removeComments(content) {
        var id = 0,
            protect = {};

        //js不支持平衡组，所以只能先把引号里面的内容先保护好
        content = content
            .replace(/("|').*?\1/g, function(m0) {
            protect[id] = m0;
            return '\u0019' + (id++) + '\u0019';
        });

        //去掉注释
        content = content
            .replace(/\s*\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')

        // 删除空行中的空白字符
        .replace(/^ +$/gm, '')

        // 删除首尾的空行
        .replace(/^\n+/, '')
            .replace(/^\n+/, '')

        // 删除多余的空行
        .replace(/\n{2,}/g, '\n');

        //还原受保护的内容
        content = content
            .replace(/\u0019(\d+)\u0019/g, function(m0, m1) {
            return protect[m1];
        });

        return content;
    }

    function outputRows(rows) {
        var maxLen = [],
            strs = [],
            str,
            sep;

        rows[0].forEach(function(cell, i) {
            maxLen[i] = cell.length;
        });

        rows.forEach(function(row) {
            row.forEach(function(cell, i) {
                if (cell.length > maxLen[i]) {
                    maxLen[i] = cell.length;
                }
            });
        });

        rows.forEach(function(row, i) {
            sep = i === 0 ? '^' : '|';
            str = sep + ' ';
            row.forEach(function(cell, j) {
                str += sprintf('%-' + maxLen[j] + 's', cell) + ' ' + sep + ' ';
            });

            strs.push(str);
        });

        grunt.log.writeln(strs.join('\n'));
    }

    function curry( fn ) {
        var slice = [].slice,
            prefix = slice.call( arguments, 1 );

        return function() {
            var args = slice.call( arguments, 0 );
            return fn.apply( this, prefix.concat( args ) );
        }
    }

    function collectRow( cols, filepath, cwd ) {
        var row = [];

        return cols
                .reduce( function( sofar, info ) {
                    return sofar
                        .then(function( value ) {

                            if ( value !== '((first))' ) {
                                row.push( value );
                            }
                        })
                        .then(function() {
                            return handler[ info ] ? 
                                    handler[info].call(handler, filepath, cwd) :
                                    '';
                        });

                }, q.resolve('((first))') )

                .then(function( value ) {
                    row.push( value );
                    return row;
                });
    }

    grunt.registerMultiTask( 'size', 'Report file size.', function() {
        var done = this.async(),
            opts = this.options({
                cols: [ 'filepath', 'origin', 'removecomments', 'uglify', 'uglify_gzip' ]
            }),
            deferreds;

        deferreds = this.files.map(function( f ) {
            var deferred = q.defer(),
                cwd = f.cwd || '',
                files,
                rows,
                cols;

            files = f.src.filter(function( filepath ) {

                if (!grunt.file.exists( cwd + filepath )) {
                    grunt.log.warn( 'Source file "' + filepath + '" not found.' );
                    return false;
                } else {
                    return true;
                }
            });

            if ( files.length ) {
                rows = [];
                cols = opts.cols;

                // 加入Header
                rows[ 0 ] = [];
                cols.forEach(function( info ) {
                    rows[ 0 ].push( header[ info ] );
                });

                grunt.log.writeln( 'Computing ...\n' );

                return files.reduce( function( sofar, filepath ) {

                        return sofar
                                .then(function( value ) {
                                    if ( value !== '((first))' ) {
                                        rows.push( value );
                                    }
                                })
                                .then( curry( collectRow, cols, filepath, cwd ) );

                    }, q.resolve( '((first))' ) )

                            .then(function( value ) {
                                rows.push( value );
                                outputRows( rows );
                                deferred.resolve( true );
                            });
            }

            return false;
        });

        q.all( deferreds ).then( done ).fail( function( reason ) {
            grunt.verbose.error( reason );
            done( reason );
        });
    });
};