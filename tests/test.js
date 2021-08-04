import {promisify} from 'util'
import {readFile} from 'fs'
import {strictEqual, ok as assertOk} from 'assert'

const stubQueries = JSON.parse((await promisify(readFile)('tests/queries.json')).toString())
const stubRegistrationPrefixes = JSON.parse((await promisify(readFile)('registrationPrefixes.json')).toString())

import {Functions} from '../functions.js'
class StubbedFunctions extends Functions {
	async queryOverpass(query) {
		query = query.replace(/\n/g, '').replace(/\r/g, '')
		return JSON.parse(stubQueries[query])
	}

	getRegistrationPrefixes() {
		return stubRegistrationPrefixes
	}
}
const functions = new StubbedFunctions()


strictEqual(await functions.geocode(51.4703,-0.4737), 'London Heathrow Airport (LHR), United Kingdom')
strictEqual(await functions.geocode(34.88398,33.63031), 'Larnaca International Airport (LCA), Cyprus')
strictEqual(await functions.geocode(51.280746, -0.777569), 'Farnborough Airport (FAB), Rushmoor, United Kingdom')


strictEqual(functions.getDemonymForReg('N147QS'), "American")
strictEqual(functions.getDemonymForReg('N18LS'), "American")
strictEqual(functions.getDemonymForReg('CS-PHD'), "Portuguese")
strictEqual(functions.getDemonymForReg('T7-AAA'), "Sammarinese")
strictEqual(functions.getDemonymForReg('9H-JPC'), "Maltese")
strictEqual(functions.getDemonymForReg('EI-EBY'), "Irish")
strictEqual(functions.getDemonymForReg('PH-LAU'), "Dutch")
strictEqual(functions.getDemonymForReg('YU-BTB'), "Serbian")
strictEqual(functions.getDemonymForReg('HB-JFI'), "Swiss")
strictEqual(functions.getDemonymForReg('SE-RFL'), "Swedish")
strictEqual(functions.getDemonymForReg('OK-NTU'), "Czech")
strictEqual(functions.getDemonymForReg('ZA681'), "Albanian/British(?) military")


function assertBearingCloseTo(from, to, expected) {
	let actual = functions.calculateBearing(from, to)
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


strictEqual(functions.bearingCloseEnough(10, 349), false)
strictEqual(functions.bearingCloseEnough(10, 350), true)
strictEqual(functions.bearingCloseEnough(10, 351), true)
strictEqual(functions.bearingCloseEnough(10, 29), true)
strictEqual(functions.bearingCloseEnough(10, 30), true)
strictEqual(functions.bearingCloseEnough(10, 31), false)

strictEqual(functions.bearingCloseEnough(60, 39), false)
strictEqual(functions.bearingCloseEnough(60, 40), true)
strictEqual(functions.bearingCloseEnough(60, 41), true)
strictEqual(functions.bearingCloseEnough(60, 79), true)
strictEqual(functions.bearingCloseEnough(60, 80), true)
strictEqual(functions.bearingCloseEnough(60, 81), false)

strictEqual(functions.bearingCloseEnough(350, 329), false)
strictEqual(functions.bearingCloseEnough(350, 330), true)
strictEqual(functions.bearingCloseEnough(350, 331), true)
strictEqual(functions.bearingCloseEnough(350, 9), true)
strictEqual(functions.bearingCloseEnough(350, 10), true)
strictEqual(functions.bearingCloseEnough(350, 11), false)
