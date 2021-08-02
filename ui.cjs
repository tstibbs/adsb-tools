//load with e.g. jQuery.getScript('http://127.0.0.1:8080/ui.cjs?latMin=123&latMax=456&lonMin=789&lonMax=012') - use params to define bounding box, when something enters the box, you'll be notified.

const scriptUrl = new URL(document.currentScript.src)
const scriptDir = scriptUrl.origin + scriptUrl.pathname.split('/').slice(0, -1).join('/')
const searchParams = scriptUrl.searchParams

let registrationPrefixes = null
jQuery.ajax(`${scriptDir}/registrationPrefixes.json`).then(data => {
	registrationPrefixes = data
})

function getParam(name) {
	let param = searchParams.get(name)
	if (param == null) {
		return null
	} else {
		return parseFloat(param)
	}
}

const latMin = getParam('latMin', )
const latMax = getParam('latMax')
const lonMin = getParam('lonMin')
const lonMax = getParam('lonMax')
const maxHeight = getParam('maxHeight')//measured in feet
const direction = getParam('direction')//degrees
console.log({latMin, latMax, lonMin, lonMax, maxHeight, direction})

Notification.requestPermission().then((result) => {
	console.log(`Notification permission: ${result}`)
});

oldWqi = wqi
const dataFetchIntervalPointer = setInterval(fetchData, 30*1000)//means it will be fetched even if we are off the screen

const seenHexes = []
const craftPoints = {}
wqi = async function(...args) {
	oldWqi(...args)
	let result = args[0]
	let crafts = result.aircraft.filter(craft =>
		craft != undefined && craft.alt_baro != undefined && craft.alt_baro != "ground" && craft.lat != undefined && craft.lon != undefined
	).map(craft => ({
		height: craft.alt_baro, //in feet
		lat: craft.lat,
		lon: craft.lon,
		registration: craft.r,
		flight: craft.flight,
		type: craft.t,
		hex: craft.hex
	}))
	crafts = crafts.filter(craft =>
		craft.lat > latMin && craft.lat < latMax && craft.lon > lonMin && craft.lon < lonMax
	)
	crafts = crafts.filter(craft =>
		!seenHexes.includes(craft.hex)
	)
	if (maxHeight != null) {
		crafts = crafts.filter(craft =>
			craft.height <= maxHeight
		)
	}
	if (crafts.length > 0 && direction != null) {
		//store first point that we see this craft at
		//then as soon as we get a second point, calculate the bearing
		//if non-matching, ignore for now, but store the new point
		//repeat, in case it turns onto the right track
		crafts = crafts.filter(craft => {
			const previous = craftPoints[craft.hex]
			const current = {lat: craft.lat, lon: craft.lon}
			craftPoints[craft.hex] = current
			if (previous == undefined) {
				return false//filter out for now, filtering out here doesn't add to seenHexes so it will still be evaluated in the next run
			} else {
				let bearing = calculateBearing(previous, current)
				return bearingCloseEnough(direction, bearing)
			}
		})
	}
	if (crafts.length > 0) {
		seenHexes.push.apply(seenHexes, crafts.map(craft => craft.hex))
		crafts.forEach(processNewCraft)//no need to wait for this, might as well fire them off in parallel
	}
}

async function processNewCraft(craft) {
	let data = await fetchTraces(craft.hex)
	const {historic, recent, desc} = data
	const startPoint = findStartPoint(historic, recent)
	const prefix = `${desc} (${craft.registration}) started from`
	console.debug(`DEBUG: hex/icao=${craft.hex}, type=${craft.type}, callsign=${craft.flight.trim()}, startPoint=${startPoint.join(',')}`)
	try {
		let text = await geocode(startPoint[0], startPoint[1])
		text = `${prefix} ${text}`
		let demonym = getDemonymForReg(craft.registration)
		if (demonym != null) {
			text = `${demonym} ${text}`
		}
		console.log(text)
		new Notification('ADS-B Exchange', {
			body: text,
			requireInteraction: true
		})
	} catch (e) {
		console.error(e)
		console.log(`${prefix} [error getting location info, see debug for coords]`)
		throw e
	}
}

function buildGeocodeQuery(lat, lon) {
return `[timeout:10][out:json];
is_in(${lat},${lon})->.a;
way(pivot.a);
out tags;
relation(pivot.a);
out tags;`
}

function buildNearbyQuery(lat, lon) {
return `[timeout:10][out:json];
node(around:2000,${lat},${lon})->.nearby;
(
	node.nearby[aeroway=aerodrome];
	node.nearby[aerodrome];
)->.nearbyAirports;
.nearbyAirports out tags meta;`
}

async function queryOverpass(query) {
	return await jQuery.ajax({
		url: 'https://overpass-api.de/api/interpreter',
		data: query,
		dataType: 'json',
		method: 'POST'
	})
}

function parseAirport(airport) {
	let airportName = airport.tags['name:en'] || airport.tags.name
	let code = airport.tags.iata
	if (code != null) {
		airportName += ` (${code})`
	}
	let cityName = airport.tags['city_served']
	return {
		airportName,
		cityName
	}
}

async function geocode(lat, lon) {
	let query = buildGeocodeQuery(lat, lon)
	let result = await queryOverpass(query)

	let countryName = null
	let airportName = null
	let cityName = null
	let elements = result.elements == null ? [] : result.elements.filter(element => element.tags != undefined)
	let countries = elements.filter(element => element.tags != undefined && element.tags['admin_level'] == "2")
	if (countries.length > 0) {
		//if there are multiple, pick the one with the 'ISO3166-1' tag, otherwise pick the one with the most tags, otherwise just pick whatever's first
		countries = countries.sort((a, b) => {
			let aIso = 'ISO3166-1' in a.tags
			let bIso = 'ISO3166-1' in b.tags
			if (aIso && !bIso) {
				return -1;
			} else if (bIso && !aIso) {
				return 1;
			} else {
				return Object.entries(b.tags).length - Object.entries(a.tags).length //return positive number if you want b to appear before a (i.e. if it is longer)
			}
		})
		let country = countries[0]
		countryName = country.tags['name:en'] || country.tags.name
	}
	// if tags contains aerodrome or "aeroway"="aerodrome" then use this one
	airport = elements.find(element => element.tags['aerodrome'] != undefined || element.tags['aeroway'] == 'aerodrome')
	if (airport != null) {
		let parsed = parseAirport(airport)
		airportName = parsed.airportName
		cityName = parsed.cityName
	}
	if (airportName == null) {
		//point not enclosed by any airport way or relation, so go looking for a nearby airport _node_
		let nearbyQuery = buildNearbyQuery(lat, lon)
		let nearbyResult = await queryOverpass(nearbyQuery)
		let nearbyelements = nearbyResult.elements.filter(element => element.tags != undefined)
		let aerodromes = nearbyelements.filter(element => element.tags['aerodrome'] != undefined || element.tags['aeroway'] == 'aerodrome')
		if (aerodromes.length > 0) {
			let aerodrome = aerodromes[0]
			if (aerodromes.length > 1) {
				let distances = []
				let aerodromesByDistance = Object.fromEntries(aerodromes.map(element => {
					element.lon
					element.lat
					let x = Math.abs(lon - element.lon)
					let y = Math.abs(lat - element.lat)
					let distance = Math.sqrt(x^2 + y^2)
					distances.push(distance)
					return [`${distance}`, element]
				}))
				aerodrome = aerodromesByDistance[`${distances.sort()[0]}`]
			}
			let parsed = parseAirport(aerodrome)
			airportName = parsed.airportName
			cityName = parsed.cityName
		}
	}

	if (cityName == null) {
		city = elements.find(element => element.tags['place'] == 'city');//semi colon to force a new statement evaluation because chrome thinks the array below is indexing into the result of the line above
		//note administrative levels are ordered like this deliberately - 6 is a county boundary which isn't ideal (too big) but is a decent fallback if we don't find anything at the others
		["7", "8", "9", "6"].forEach(level => {
			if (city == null) {
				city = elements.find(element => element.tags['admin_level'] == level)
			}
		})
	}
	if (city != null) {
		cityName = city.tags['name:en'] || city.tags.name
	}
	if (airportName == null) {
		airportName = 'Unknown'
	}
	if (cityName == null) {
		cityName = 'Unknown'
	}
	if (countryName == null) {
		countryName = 'Unknown'
	}
	return `${airportName}, ${cityName}, ${countryName}`
	//test data:
	// 51.4703,-0.4737 -> heathrow
	// 34.88398,33.63031 -> Larnaca International Airport, Cyprus
	// 51.280746, -0.777569 -> farnborough
}

function normalizeTraceStamps(data) {
	return data.trace.map(point => [point[0] + data.timestamp, ...point.slice(1)])
}

function buildAllTraces(historic, recent) {
	historic = normalizeTraceStamps(historic)
	recent = normalizeTraceStamps(recent)
	let recentStart = recent[0][0]
	let recentCutoff = historic.findIndex(point => point[0] > recentStart)
	if (recentCutoff != -1) {
		historic = historic.slice(0, recentCutoff)
	}
	let trace = historic.concat(recent)
	return trace
}

function buildCurrentTrace(trace) {
	let details = trace.filter(point => point[8] != null && typeof point[8] === 'object')
	let flight = details[details.length - 1][8].flight
	let startOfFlight = trace.findIndex(point => point[8] != null && typeof point[8] === 'object' && point[8].flight == flight)
	if (startOfFlight == -1) {
		startOfFlight = 0
	}
	//it appears that if you bitwise and with 2, then a non-zero answer indicates some kind of 'new leg' flag
	//weird spread in the next line is because `reverse` reverses the array *in place* which is not what we want in this case
	let lastNonLegFlag = [...trace].reverse().findIndex(point => (point[6] & 2) != 0)
	if (lastNonLegFlag == -1) {
		lastNonLegFlag = 0
	} else {
		lastNonLegFlag = trace.length - lastNonLegFlag //undo the reverse
	}
	console.debug(`trace.length=${trace.length}, startOfFlight=${startOfFlight}, lastNonLegFlag=${lastNonLegFlag}`)
	console.debug(`startOfFlight: ${trace[startOfFlight][0]}, ${trace[startOfFlight][1]},${trace[startOfFlight][2]}`)
	console.debug(`lastNonLegFlag: ${trace[lastNonLegFlag][0]}, ${trace[lastNonLegFlag][1]},${trace[lastNonLegFlag][2]}`)
	trace = trace.slice(Math.max(startOfFlight, lastNonLegFlag), trace.length)
	return trace
}

function findStartPoint(historic, recent) {
	let allTraces = buildAllTraces(historic, recent)
	let trace = buildCurrentTrace(allTraces)
	if (trace.length == 0 || trace[0] == undefined) {
		console.error(`Something weird happened. historic=${historic}, recent=${recent}, allTraces.length=${allTraces.length}, trace.length=${trace.length}`)
	}
	let startPoint = [trace[0][1], trace[0][2]]
	return startPoint
}

async function fetchTraces(hex) {
	hex = hex.toLowerCase()

	let url1 = 'data/traces/'+ hex.slice(-2) + '/trace_recent_' + hex + '.json';
	let url2 = 'data/traces/'+ hex.slice(-2) + '/trace_full_' + hex + '.json';

	let req1 = jQuery.ajax({ url: url1,
		dataType: 'json'
	});

	let req2 = jQuery.ajax({ url: url2,
		dataType: 'json'
	});

	let [recent, historic] = await Promise.all([req1, req2])
	let desc = recent.desc
	return {historic, recent, desc}
}

function calculateBearing(point1, point2) {
	const lat1 = point1.lat
	const lon1 = point1.lon
	const lat2 = point2.lat
	const lon2 = point2.lon
	//following code borrowed from https://www.movable-type.co.uk/scripts/latlong.html
	const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
	const x = (Math.cos(lat1) * Math.sin(lat2)) - (Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1))
	const rawAngle = Math.atan2(y, x)
	const bearing = (((rawAngle * 180) / Math.PI) + 360) % 360 // in degrees
	return bearing
}

function bearingCloseEnough(expected, actual) {
	const variance = 20 //i.e. this much either way is allowed, so total range will be twice this value
	const min = expected - variance
	const max = expected + variance

	if (min >= 0 && max <= 360) {
		return actual >= min && actual <= max
	} else if (min < 0 && max <= 360) {
		return actual >= (min + 360) || actual <= max
	} else if (min >= 0 && max > 360) {
		return actual >= min || actual <= (max - 360)
	} else {//if (min < 0 && max > 360)
		throw new Error(`Something went wrong: ${JSON.stringify({expected, actual, variance, min, max})}`)
	}
}

function getDemonymForReg(reg) {
	//registrations are weirdly overlapping, for example P- and PK- belong to completely different country, but the list we have doesn't (necessarily) specify the hyphen
	let potentials = Object.entries(registrationPrefixes).filter(([prefix, demonym]) =>
		reg.startsWith(prefix)
	).sort(([prefixA, demonymA], [prefixB, demonymB]) =>
		prefixB.length - prefixA.length
	)
	let maxPotentialLength = Math.max(...(potentials.map(([prefix, demonym]) => prefix.length)))
	//get all the most likely based on being the longest
	potentials = potentials.filter(([prefix, demonym]) =>
		prefix.length == maxPotentialLength
	).map(([prefix, demonym]) =>
		demonym
	)
	if (!reg.includes('-') && reg.startsWith('Z')) {
		potentials.push("British(?) military")
	}
	demonym = potentials.join('/')//combine into a single string for display
	return demonym
}

//for easy re-use in local testing
uiInjection = {
	findStartPoint,
	dataFetchIntervalPointer
}
