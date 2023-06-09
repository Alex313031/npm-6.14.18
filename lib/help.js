
module.exports = help

help.completion = function (opts, cb) {
  if (opts.conf.argv.remain.length > 2) return cb(null, [])
  getSections(cb)
}

var path = require('path')
var spawn = require('./utils/spawn')
var npm = require('./npm.js')
var log = require('npmlog')
var openUrl = require('./utils/open-url')
var glob = require('glob')
var didYouMean = require('./utils/did-you-mean')
var cmdList = require('./config/cmd-list').cmdList
var shorthands = require('./config/cmd-list').shorthands
var commands = cmdList.concat(Object.keys(shorthands))
var output = require('./utils/output.js')

function help (args, cb) {
  var argv = npm.config.get('argv').cooked

  var argnum = 0
  if (args.length === 2 && ~~args[0]) {
    argnum = ~~args.shift()
  }

  // npm help foo bar baz: search topics
  if (args.length > 1 && args[0]) {
    return npm.commands['help-search'](args, argnum, cb)
  }

  var section = npm.deref(args[0]) || args[0]

  // npm help <noargs>:  show basic usage
  if (!section) {
    var valid = argv[0] === 'help' ? 0 : 1
    return npmUsage(valid, cb)
  }

  // npm <command> -h: show command usage
  if (npm.config.get('usage') &&
      npm.commands[section] &&
      npm.commands[section].usage) {
    npm.config.set('loglevel', 'silent')
    log.level = 'silent'
    output(npm.commands[section].usage)
    return cb()
  }

  // npm apihelp <section>: Prefer section 3 over section 1
  var apihelp = argv.length && argv[0].indexOf('api') !== -1
  var pref = apihelp ? [3, 1, 5, 7] : [1, 3, 5, 7]
  if (argnum) {
    pref = [ argnum ].concat(pref.filter(function (n) {
      return n !== argnum
    }))
  }

  // npm help <section>: Try to find the path
  var manroot = path.resolve(__dirname, '..', 'man')

  // legacy
  if (section === 'global') section = 'folders'
  else if (section.match(/.*json/)) section = section.replace('.json', '-json')

  // find either /section.n or /npm-section.n
  // The glob is used in the glob.  The regexp is used much
  // further down.  Globs and regexps are different
  var compextglob = '.+(gz|bz2|lzma|[FYzZ]|xz)'
  var compextre = '\\.(gz|bz2|lzma|[FYzZ]|xz)$'
  var f = '+(npm-' + section + '|' + section + ').[0-9]?(' + compextglob + ')'
  return glob(manroot + '/*/' + f, function (er, mans) {
    if (er) return cb(er)

    if (!mans.length) return npm.commands['help-search'](args, cb)

    mans = mans.map(function (man) {
      var ext = path.extname(man)
      if (man.match(new RegExp(compextre))) man = path.basename(man, ext)

      return man
    })

    viewMan(pickMan(mans, pref), cb)
  })
}

function pickMan (mans, pref_) {
  var nre = /([0-9]+)$/
  var pref = {}
  pref_.forEach(function (sect, i) {
    pref[sect] = i
  })
  mans = mans.sort(function (a, b) {
    var an = a.match(nre)[1]
    var bn = b.match(nre)[1]
    return an === bn ? (a > b ? -1 : 1)
      : pref[an] < pref[bn] ? -1
        : 1
  })
  return mans[0]
}

function viewMan (man, cb) {
  var nre = /([0-9]+)$/
  var num = man.match(nre)[1]
  var section = path.basename(man, '.' + num)

  // at this point, we know that the specified man page exists
  var manpath = path.join(__dirname, '..', 'man')
  var env = {}
  Object.keys(process.env).forEach(function (i) {
    env[i] = process.env[i]
  })
  env.MANPATH = manpath
  var viewer = npm.config.get('viewer')

  var conf
  switch (viewer) {
    case 'woman':
      var a = ['-e', '(woman-find-file \'' + man + '\')']
      conf = { env: env, stdio: 'inherit' }
      var woman = spawn('emacsclient', a, conf)
      woman.on('close', cb)
      break

    case 'browser':
      openUrl(htmlMan(man), 'help available at the following URL', cb)
      break

    default:
      conf = { env: env, stdio: 'inherit' }
      var manProcess = spawn('man', [num, section], conf)
      manProcess.on('close', cb)
      break
  }
}

function htmlMan (man) {
  var sect = +man.match(/([0-9]+)$/)[1]
  var f = path.basename(man).replace(/[.]([0-9]+)$/, '')
  switch (sect) {
    case 1:
      sect = 'commands'
      break
    case 5:
      sect = 'configuring-npm'
      break
    case 7:
      sect = 'using-npm'
      break
    default:
      throw new Error('invalid man section: ' + sect)
  }
  return path.resolve(__dirname, '..', 'docs', 'output', sect, f + '.html')
}

function npmUsage (valid, cb) {
  npm.config.set('loglevel', 'silent')
  log.level = 'silent'
  output([
    '\nUsage: npm <command>',
    '',
    'where <command> is one of:',
    npm.config.get('long') ? usages()
      : '    ' + wrap(commands),
    '',
    'npm <command> -h  quick help on <command>',
    'npm -l            display full usage info',
    'npm help <term>   search for help on <term>',
    'npm help npm      involved overview',
    '',
    'Specify configs in the ini-formatted file:',
    '    ' + npm.config.get('userconfig'),
    'or on the command line via: npm <command> --key value',
    'Config info can be viewed via: npm help config',
    '',
    'npm@' + npm.version + ' ' + path.dirname(__dirname)
  ].join('\n'))

  if (npm.argv.length > 1) {
    output(didYouMean(npm.argv[1], commands))
  }

  cb(valid)
}

function usages () {
  // return a string of <command>: <usage>
  var maxLen = 0
  return Object.keys(npm.commands).filter(function (c) {
    return c === npm.deref(c)
  }).reduce(function (set, c) {
    set.push([c, npm.commands[c].usage || ''])
    maxLen = Math.max(maxLen, c.length)
    return set
  }, []).map(function (item) {
    var c = item[0]
    var usage = item[1]
    return '\n    ' +
      c + (new Array(maxLen - c.length + 2).join(' ')) +
      (usage.split('\n').join('\n' + (new Array(maxLen + 6).join(' '))))
  }).join('\n')
}

function wrap (arr) {
  var out = ['']
  var l = 0
  var line

  line = process.stdout.columns
  if (!line) {
    line = 60
  } else {
    line = Math.min(60, Math.max(line - 16, 24))
  }

  arr.sort(function (a, b) { return a < b ? -1 : 1 })
    .forEach(function (c) {
      if (out[l].length + c.length + 2 < line) {
        out[l] += ', ' + c
      } else {
        out[l++] += ','
        out[l] = c
      }
    })
  return out.join('\n    ').substr(2)
}

function getSections (cb) {
  var g = path.resolve(__dirname, '../man/man[0-9]/*.[0-9]')
  glob(g, function (er, files) {
    if (er) return cb(er)

    cb(null, Object.keys(files.reduce(function (acc, file) {
      file = path.basename(file).replace(/\.[0-9]+$/, '')
      file = file.replace(/^npm-/, '')
      acc[file] = true
      return acc
    }, { help: true })))
  })
}
