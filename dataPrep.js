import {promisify} from 'util'
import {writeFile as rawWriteFile} from 'fs'

import wtf from 'wtf_wikipedia'
import {chunk} from 'underscore'

const writeFile = promisify(rawWriteFile)

async function buildPrefixes() {
	let doc = await wtf.fetch('List of aircraft registration prefixes')

	let sections = doc.sections().filter(section => section.title().startsWith('Current'))
	let mappings = sections[0].tables()[0].data

	let countryToPrefixes = mappings.reduce((all, mapping) => {
		let country = mapping['Country or region'].data.links[0].data.page
		let registrationText = mapping['Registration prefix'].data.text
		if (!(country in all)) {
			all[country] = []
		}
		let prefixes = registrationText.split(', ').map(prefix => {
			let matches = /^([A-Z0-9-]+)(\s.*)?$/.exec(prefix)
			if (matches != null) {
				return matches[1]
			} else {
				return null
			}
		}).filter(prefix => prefix != null);
		[].push.apply(all[country], prefixes)
		return all
	}, {})
	return countryToPrefixes
}

function splitToFirstNonEmpty(input, splitter) {
	return input.split(splitter).find(candidate => candidate.trim() != '')
}

async function buildAjectives(countries) {
	let docs = await wtf.fetch(countries, { follow_redirects: false })
	if (!Array.isArray(docs)) {//can happen if the redirect stuff only sends a single country to be retrieved
		docs = [docs]//it's annoying that the return is inconsistently typed
	}
	let redirects = {}
	let demonyms = []
	docs.forEach(doc => {
		if (doc.isRedirect()) {
			let from = doc.title()
			let to = doc.redirectTo().page
			if (!(to in redirects)) {
				redirects[to] = []
			}
			redirects[to].push(from)
		} else {
			let country = doc.title()
			let demonym = null
			try {
				let potentialDemonym = doc.infoboxes().find(infobox => 'demonym' in infobox.keyValue())
				if (potentialDemonym != undefined) {
					potentialDemonym = potentialDemonym.get('demonym')
				}
				if (potentialDemonym == null) {
					potentialDemonym = doc.infoboxes().find(infobox => 'population_demonym' in infobox.keyValue()).get('population_demonym')
				}
				potentialDemonym = potentialDemonym.json().text
				let linkMatches = potentialDemonym.match(/\[\[.+\|(.+)(\n.+)*/)
				if (linkMatches != null) {
					potentialDemonym = linkMatches[1]
				}
				potentialDemonym = splitToFirstNonEmpty(potentialDemonym, /\n+/)
				potentialDemonym = splitToFirstNonEmpty(potentialDemonym, ' · ')
				potentialDemonym = splitToFirstNonEmpty(potentialDemonym, '· ')
				potentialDemonym = splitToFirstNonEmpty(potentialDemonym, ' / ')
				potentialDemonym = splitToFirstNonEmpty(potentialDemonym, ' or ')
				potentialDemonym = splitToFirstNonEmpty(potentialDemonym, ', ')
				potentialDemonym = splitToFirstNonEmpty(potentialDemonym, '; ')
				
				let bracketMatches = potentialDemonym.match(/^([^(]+)\(.*$/)
				if (bracketMatches != null) { //keep anything to the left of the first set of brackets
					potentialDemonym = bracketMatches[1]
				}

				potentialDemonym = potentialDemonym.trim()
				if (potentialDemonym != '') {
					demonym = potentialDemonym
				} else {
					throw new Error(`potentialDemonym was empty string.`)
				}
			} catch (e) {
				console.error(`Extraction failed for ${country}, falling back to suffix.`)
				console.error(e)
			}
			demonyms.push([country, demonym])
		}
	})
	//recursively deal with any redirects
	if (Object.entries(redirects).length > 0) {
		console.log(`Dealing with redirects: ${JSON.stringify(redirects)}`)
		let redirectedDemonyms = await buildAjectives(Object.keys(redirects))
		redirectedDemonyms.forEach(([country, demonym]) => {
			let froms = redirects[country]
			froms.forEach(from => {
				demonyms.push([from, demonym])
			})
		})
	}
	return demonyms
}

let countryToPrefixes = await buildPrefixes()
let demonyms = []
for (let subList of chunk(Object.keys(countryToPrefixes), 50)) {
	demonyms.push(...(await buildAjectives(subList)))
}
demonyms = Object.fromEntries(demonyms)

let prefixesToDemonyms = Object.entries(countryToPrefixes).reduce((all, [country, prefixes]) => {
	prefixes.forEach(prefix => {
		let demonym = demonyms[country]
		if (demonym == null || demonym == '') {
			console.error(`No demomym found for ${country}, falling back to suffix`)
			demonym = `${country}-ian`
		}
		all[prefix] = demonym
	})
	return all
}, {})

await writeFile('registrationPrefixes.json', JSON.stringify(prefixesToDemonyms))
