/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const Kefir = require('../dist/kefir')
const sinon = require('sinon')

Kefir.dissableDeprecationWarnings()

exports.Kefir = Kefir

const logItem = function(event, isCurrent) {
  if (event.type === 'value') {
    if (isCurrent) {
      return {current: event.value}
    } else {
      return event.value
    }
  } else if (event.type === 'error') {
    if (isCurrent) {
      return {currentError: event.value}
    } else {
      return {error: event.value}
    }
  } else {
    if (isCurrent) {
      return '<end:current>'
    } else {
      return '<end>'
    }
  }
}

exports.watch = function(obs) {
  const log = []
  const fn = event => log.push(logItem(event, isCurrent))
  const unwatch = () => obs.offAny(fn)
  var isCurrent = true
  obs.onAny(fn)
  isCurrent = false
  return {log, unwatch}
}

exports.watchWithTime = function(obs) {
  const startTime = new Date()
  const log = []
  let isCurrent = true
  obs.onAny(event => log.push([new Date() - startTime, logItem(event, isCurrent)]))
  isCurrent = false
  return log
}

exports.send = function(obs, events) {
  for (let event of Array.from(events)) {
    if (event === '<end>') {
      obs._emitEnd()
    }
    if (typeof event === 'object' && 'error' in event) {
      obs._emitError(event.error)
    } else {
      obs._emitValue(event)
    }
  }
  return obs
}

const _activateHelper = function() {}

exports.activate = function(obs) {
  obs.onEnd(_activateHelper)
  return obs
}

exports.deactivate = function(obs) {
  obs.offEnd(_activateHelper)
  return obs
}

exports.prop = () => new Kefir.Property()

exports.stream = () => new Kefir.Stream()

exports.pool = () => new Kefir.Pool()

// This function changes timers' IDs so "simultaneous" timers are reversed
// Also sets createdAt to 0 so closk.tick will sort by ID
// FIXME:
//   1) Not sure how well it works with interval timers (setInterval), probably bad
//   2) We need to restore (unshake) them back somehow (after calling tick)
//   Hopefully we'll get a native implementation, and wont have to fix those
//   https://github.com/sinonjs/lolex/issues/24
const shakeTimers = function(clock) {
  const ids = Object.keys(clock.timers)
  const timers = ids.map(id => clock.timers[id])

  // see https://github.com/sinonjs/lolex/blob/a93c8a9af05fb064ae5c2ad1bfc72874973167ee/src/lolex.js#L175-L209
  timers.sort(function(a, b) {
    if (a.callAt < b.callAt) {
      return -1
    }
    if (a.callAt > b.callAt) {
      return 1
    }
    if (a.immediate && !b.immediate) {
      return -1
    }
    if (!a.immediate && b.immediate) {
      return 1
    }

    // Following two cheks are reversed
    if (a.createdAt < b.createdAt) {
      return 1
    }
    if (a.createdAt > b.createdAt) {
      return -1
    }
    if (a.id < b.id) {
      return 1
    }
    if (a.id > b.id) {
      return -1
    }
  })

  ids.sort((a, b) => a - b)
  return timers.forEach(function(timer, i) {
    const id = ids[i]
    timer.createdAt = 0
    timer.id = id
    return (clock.timers[id] = timer)
  })
}

exports.withFakeTime = function(cb, reverseSimultaneous) {
  if (reverseSimultaneous == null) {
    reverseSimultaneous = false
  }
  const clock = sinon.useFakeTimers(10000)
  const tick = function(t) {
    if (reverseSimultaneous) {
      shakeTimers(clock)
    }
    return clock.tick(t)
  }
  cb(tick, clock)
  return clock.restore()
}

exports.inBrowser =
  typeof window !== 'undefined' && window !== null && (typeof document !== 'undefined' && document !== null)

exports.withDOM = function(cb) {
  const div = document.createElement('div')
  document.body.appendChild(div)
  cb(div)
  return document.body.removeChild(div)
}

// see:
//   https://github.com/rpominov/kefir/issues/134
//   https://github.com/rpominov/kefir/pull/135
exports.shakyTimeTest = function(testCb) {
  it('[shaky time test: normal run]', function() {
    const expectToEmitOverShakyTime = (stream, expectedLog, cb, timeLimit) =>
      expect(stream).toEmitInTime(expectedLog, cb, timeLimit)
    return testCb(expectToEmitOverShakyTime)
  })

  return it('[shaky time test: reverse run]', function() {
    const expectToEmitOverShakyTime = (stream, expectedLog, cb, timeLimit) =>
      expect(stream).toEmitInTime(expectedLog, cb, timeLimit, true)
    return testCb(expectToEmitOverShakyTime)
  })
}

beforeEach(function() {
  return this.addMatchers({
    toBeProperty() {
      this.message = function() {
        return `Expected ${this.actual.toString()} to be instance of Property`
      }
      return this.actual instanceof Kefir.Property
    },
    toBeStream() {
      this.message = function() {
        return `Expected ${this.actual.toString()} to be instance of Stream`
      }
      return this.actual instanceof Kefir.Stream
    },
    toBePool() {
      this.message = function() {
        return `Expected ${this.actual.toString()} to be instance of Pool`
      }
      return this.actual instanceof Kefir.Pool
    },

    toBeActive() {
      return this.actual._active
    },

    toEmit(expectedLog, cb) {
      const {log, unwatch} = exports.watch(this.actual)
      if (typeof cb === 'function') {
        cb()
      }
      unwatch()
      this.message = () => `Expected to emit ${jasmine.pp(expectedLog)}, actually emitted ${jasmine.pp(log)}`
      return this.env.equals_(expectedLog, log)
    },

    errorsToFlow(source) {
      const expectedLog = this.isNot ? [] : [{error: -2}, {error: -3}]
      if (this.actual instanceof Kefir.Property) {
        exports.activate(this.actual)
        exports.send(source, [{error: -1}])
        exports.deactivate(this.actual)
        if (!this.isNot) {
          expectedLog.unshift({currentError: -1})
        }
      } else if (source instanceof Kefir.Property) {
        exports.send(source, [{error: -1}])
        if (!this.isNot) {
          expectedLog.unshift({currentError: -1})
        }
      }
      const {log, unwatch} = exports.watch(this.actual)
      exports.send(source, [{error: -2}, {error: -3}])
      unwatch()
      if (this.isNot) {
        this.message = () => `Expected errors not to flow (i.e. to emit [], actually emitted ${jasmine.pp(log)})`
        return !this.env.equals_(expectedLog, log)
      } else {
        this.message = () =>
          `Expected errors to flow (i.e. to emit ${jasmine.pp(expectedLog)}, actually emitted ${jasmine.pp(log)})`
        return this.env.equals_(expectedLog, log)
      }
    },

    toEmitInTime(expectedLog, cb, timeLimit, reverseSimultaneous) {
      if (timeLimit == null) {
        timeLimit = 10000
      }
      if (reverseSimultaneous == null) {
        reverseSimultaneous = false
      }
      let log = null
      exports.withFakeTime(tick => {
        log = exports.watchWithTime(this.actual)
        if (typeof cb === 'function') {
          cb(tick)
        }
        return tick(timeLimit)
      }, reverseSimultaneous)
      this.message = () => `Expected to emit ${jasmine.pp(expectedLog)}, actually emitted ${jasmine.pp(log)}`
      return this.env.equals_(expectedLog, log)
    },

    toActivate(...obss) {
      let obs
      const orOp = (a, b) => a || b
      const andOp = (a, b) => a && b

      const notStr = this.isNot ? 'not ' : ''
      const notNotStr = this.isNot ? '' : 'not '

      const tests = {}
      tests['some activated at start'] = true
      tests[`some ${notNotStr}activated`] = true
      tests[`some ${notNotStr}deactivated`] = true
      tests[`some ${notNotStr}activated at second try`] = true
      tests[`some ${notNotStr}deactivated at second try`] = true

      const correctResults = {}
      correctResults['some activated at start'] = true
      correctResults[`some ${notNotStr}activated`] = true
      correctResults[`some ${notNotStr}deactivated`] = true
      correctResults[`some ${notNotStr}activated at second try`] = true
      correctResults[`some ${notNotStr}deactivated at second try`] = true

      if (this.isNot) {
        correctResults[`some ${notNotStr}activated`] = false
        correctResults[`some ${notNotStr}activated at second try`] = false
      }

      const check = function(test, conditions) {
        let condition
        if (correctResults[test] === true) {
          for (condition of Array.from(conditions)) {
            if (!condition) {
              tests[test] = false
              return
            }
          }
        } else {
          for (condition of Array.from(conditions)) {
            if (condition) {
              return
            }
          }
          return (tests[test] = false)
        }
      }

      check(
        'some activated at start',
        (() => {
          const result = []
          for (obs of Array.from(obss)) {
            result.push(!obs._active)
          }
          return result
        })()
      )

      exports.activate(this.actual)
      check(
        `some ${notNotStr}activated`,
        (() => {
          const result1 = []
          for (obs of Array.from(obss)) {
            result1.push(obs._active)
          }
          return result1
        })()
      )

      exports.deactivate(this.actual)
      check(
        `some ${notNotStr}deactivated`,
        (() => {
          const result2 = []
          for (obs of Array.from(obss)) {
            result2.push(!obs._active)
          }
          return result2
        })()
      )

      exports.activate(this.actual)
      check(
        `some ${notNotStr}activated at second try`,
        (() => {
          const result3 = []
          for (obs of Array.from(obss)) {
            result3.push(obs._active)
          }
          return result3
        })()
      )

      exports.deactivate(this.actual)
      check(
        `some ${notNotStr}deactivated at second try`,
        (() => {
          const result4 = []
          for (obs of Array.from(obss)) {
            result4.push(!obs._active)
          }
          return result4
        })()
      )

      this.message = function() {
        const failedTest = (() => {
          const result5 = []
          for (let name in tests) {
            if (tests[name] !== correctResults[name]) {
              result5.push(name)
            }
          }
          return result5
        })().join(', ')
        const obssNames = (() => {
          const result6 = []
          for (obs of Array.from(obss)) {
            result6.push(obs.toString())
          }
          return result6
        })().join(', ')
        return `Expected ${this.actual.toString()} to ${notStr}activate: ${obssNames} (${failedTest})`
      }

      for (let name in tests) {
        if (tests[name] !== correctResults[name]) {
          return this.isNot
        }
      }
      return !this.isNot
    },
  })
})
