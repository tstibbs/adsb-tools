import {promisify} from 'util'
import {readFile} from 'fs'
import {strictEqual, ok as assertOk} from 'assert'

import {getDemonymForReg, calculateBearing, bearingCloseEnough, setupForTesting} from './functions.js'

setupForTesting(JSON.parse((await promisify(readFile)('registrationPrefixes.json')).toString()))

strictEqual(getDemonymForReg('N147QS'), "American")
strictEqual(getDemonymForReg('N18LS'), "American")
strictEqual(getDemonymForReg('CS-PHD'), "Portuguese")
strictEqual(getDemonymForReg('T7-AAA'), "Sammarinese")
strictEqual(getDemonymForReg('9H-JPC'), "Maltese")
strictEqual(getDemonymForReg('EI-EBY'), "Irish")
strictEqual(getDemonymForReg('PH-LAU'), "Dutch")
strictEqual(getDemonymForReg('YU-BTB'), "Serbian")
strictEqual(getDemonymForReg('HB-JFI'), "Swiss")
strictEqual(getDemonymForReg('SE-RFL'), "Swedish")


function assertBearingCloseTo(from, to, expected) {
	let actual = calculateBearing(from, to)
	let diff = Math.abs(actual - expected)
	assertOk(diff < 1, `${JSON.stringify({actual, expected})}`)
}

assertBearingCloseTo({lat: 51.44, lon: -1.32}, {lat: 51.44, lon: -1.34}, 270)
assertBearingCloseTo({lat: 51.44, lon: -1.34}, {lat: 51.44, lon: -1.32}, 90)
assertBearingCloseTo({lat: 51.44, lon: -1.34}, {lat: 51.46, lon: -1.34}, 0)
assertBearingCloseTo({lat: 51.46, lon: -1.34}, {lat: 51.44, lon: -1.34}, 180)

assertBearingCloseTo({lat: 51.46, lon: -1.34}, {lat: 51.44, lon: -1.32}, 158)//to the bottom right
assertBearingCloseTo({lat: 51.46, lon: -1.34}, {lat: 51.49, lon: -1.4}, 326)//to the top left
assertBearingCloseTo({lat: 51.46, lon: -1.34}, {lat: 51.44, lon: -1.4}, 230)//to the bottom left
assertBearingCloseTo({lat: 51.46, lon: -1.34}, {lat: 51.49, lon: -1.32}, 13)//to the top right


strictEqual(bearingCloseEnough(10, 349), false)
strictEqual(bearingCloseEnough(10, 350), true)
strictEqual(bearingCloseEnough(10, 351), true)
strictEqual(bearingCloseEnough(10, 29), true)
strictEqual(bearingCloseEnough(10, 30), true)
strictEqual(bearingCloseEnough(10, 31), false)

strictEqual(bearingCloseEnough(60, 39), false)
strictEqual(bearingCloseEnough(60, 40), true)
strictEqual(bearingCloseEnough(60, 41), true)
strictEqual(bearingCloseEnough(60, 79), true)
strictEqual(bearingCloseEnough(60, 80), true)
strictEqual(bearingCloseEnough(60, 81), false)

strictEqual(bearingCloseEnough(350, 329), false)
strictEqual(bearingCloseEnough(350, 330), true)
strictEqual(bearingCloseEnough(350, 331), true)
strictEqual(bearingCloseEnough(350, 9), true)
strictEqual(bearingCloseEnough(350, 10), true)
strictEqual(bearingCloseEnough(350, 11), false)
