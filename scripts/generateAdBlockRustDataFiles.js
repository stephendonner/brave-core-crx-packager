/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const { Engine, FilterFormat, FilterSet } = require('adblock-rs')
const { generateResourcesFile, getDefaultLists, getRegionalLists } = require('../lib/adBlockRustUtils')
const path = require('path')
const fs = require('fs')
const request = require('request')

/**
 * Returns a promise that which resolves with the list data
 *
 * @param listURL The URL of the list to fetch
 * @param filter The filter function to apply to the body
 * @return a promise that resolves with the content of the list or rejects with an error message.
 */
const getListBufferFromURL = (listURL, filter) => {
  return new Promise((resolve, reject) => {
    request.get(listURL, function (error, response, body) {
      if (error) {
        reject(new Error(`Request error: ${error}`))
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Error status code ${response.statusCode} returned for URL: ${listURL}`))
        return
      }
      if (filter) {
        body = filter(body)
      }
      resolve(body)
    })
  })
}

/**
 * Returns a filter function to apply for a specific UUID
 *
 * @param uuid The UUID that the filter function should be returned for.
 */
const getListFilterFunction = (uuid) => {
  // Apply any transformations based on list UUID here
  // if (uuid === 'FBB430E8-3910-4761-9373-840FC3B43FF2') {
  //  return (input) => input.split('\n').slice(4)
  //    .map((line) => `||${line}`).join('\n')
  // }
  return undefined
}

/**
 * Obtains the output path to store a file given the specied name and subdir
 */
const getOutPath = (outputFilename, outSubdir) => {
  let outPath = path.join('build')
  if (!fs.existsSync(outPath)) {
    fs.mkdirSync(outPath)
  }
  outPath = path.join(outPath, 'ad-block-updater')
  if (!fs.existsSync(outPath)) {
    fs.mkdirSync(outPath)
  }
  outPath = path.join(outPath, outSubdir)
  if (!fs.existsSync(outPath)) {
    fs.mkdirSync(outPath)
  }
  return path.join(outPath, outputFilename)
}

/**
 * Parses the passed in filter rule data and serializes a data file to disk.
 *
 * @param filterRuleData An array of { format, data, include_redirect_urls } where format is one of `adblock-rust`'s supported filter parsing formats and data is a newline-separated list of such filters. 
 * include_redirect_urls is a boolean: https://github.com/brave/adblock-rust/pull/184. We only support redirect URLs on filter lists we maintain and trust.
 * @param outputDATFilename The filename of the DAT file to create.
 */
const generateDataFileFromLists = (filterRuleData, outputDATFilename, outSubdir) => {
  const filterSet = new FilterSet(false)
  for (let { format, data, include_redirect_urls } of filterRuleData) {
    include_redirect_urls = Boolean(include_redirect_urls)
    const parseOpts = { format, include_redirect_urls }
    filterSet.addFilters(data.split('\n'), parseOpts)
  }
  const client = new Engine(filterSet, true)
  const arrayBuffer = client.serializeCompressed()
  const outPath = getOutPath(outputDATFilename, outSubdir)
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer))
}

/**
 * Convenience function that uses getListBufferFromURL and generateDataFileFromLists
 * to construct a DAT file from a URL while applying a specific filter.
 *
 * @param listURL the URL of the list to fetch.
 * @param the format of the filter list at the given URL.
 * @param outputDATFilename the DAT filename to write to.
 * @param filter The filter function to apply.
 * @return a Promise which resolves if successful or rejects if there's an error.
 */
const generateDataFileFromURL = (listURL, format, langs, uuid, outputDATFilename, filter) => {
  return new Promise((resolve, reject) => {
    console.log(`${langs} ${listURL}...`)
    request.get(listURL, function (error, response, body) {
      if (error) {
        reject(new Error(`Request error: ${error}`))
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Error status code ${response.statusCode} returned for URL: ${listURL}`))
        return
      }
      if (filter) {
        body = filter(body)
      }
      generateDataFileFromLists([{ format, data: body }], outputDATFilename, uuid)
      resolve()
    })
  })
}

/**
 * Convenience function that generates a DAT file for each region, and writes
 * the catalog of available regional lists to the default list directory.
 */
const generateDataFilesForAllRegions = () => {
  console.log('Processing per region list updates...')
  return getRegionalLists().then(regions => {
    return new Promise((resolve, reject) => {
      fs.writeFileSync(getOutPath('regional_catalog.json', 'default'), JSON.stringify(regions))
      resolve()
    }).then(Promise.all(regions.map(region =>
      generateDataFileFromURL(region.url,
        region.format, region.langs, region.uuid, `rs-${region.uuid}.dat`)
    )))
  })
}

/**
 * Convenience function that generates a DAT file and resources file for the default list
 */
const generateDataFilesForList = (lists, filename) => {
  let promises = []
  lists.forEach((l) => {
    console.log(`${l.url}...`)
    const filterFn = getListFilterFunction(l.uuid)
    promises.push(getListBufferFromURL(l.url, filterFn).then(data => ({ format: l.format, data, include_redirect_urls: l.include_redirect_urls })))
  })
  let p = Promise.all(promises)
  p = p.then((listBuffers) => {
    generateDataFileFromLists(listBuffers, filename, 'default')
  })
  p = p.then(() => generateResourcesFile(getOutPath('resources.json', 'default')))
  return p
}

const generateDataFilesForDefaultAdblock = () => getDefaultLists().then(defaultLists =>
    generateDataFilesForList(defaultLists, 'rs-ABPFilterParserData.dat'))

// For adblock-rust-ffi, included just as a char array via hexdump
const generateTestDataFile1 =
  generateDataFileFromLists.bind(null, [{ format: FilterFormat.STANDARD, data: 'ad-banner' }], 'ad-banner.dat', 'test-data')
// For adblock-rust-ffi, included just as a char array via hexdump
const generateTestDataFile2 =
  generateDataFileFromLists.bind(null, [{ format: FilterFormat.STANDARD, data: 'ad-banner$tag=abc' }], 'ad-banner-tag-abc.dat', 'test-data')
// For brave-core ./data/adblock-data/adblock-default/rs-ABPFilterParserData.dat
// For brave-core ./data/adblock-data/adblock-v3/rs-ABPFilterParserData.dat
const generateTestDataFile3 =
  generateDataFileFromLists.bind(null, [{ format: FilterFormat.STANDARD, data: 'adbanner\nad_banner' }], 'rs-default.dat', 'test-data')
// For brave-core ./data/adblock-data/adblock-v4/rs-ABPFilterParserData.dat
const generateTestDataFile4 =
  generateDataFileFromLists.bind(null, [{ format: FilterFormat.STANDARD, data: 'v4_specific_banner.png' }], 'rs-v4.dat', 'test-data')
// For brave-core ./brave/test/data/adblock-data/adblock-regional/
// 9852EFC4-99E4-4F2D-A915-9C3196C7A1DE/rs-9852EFC4-99E4-4F2D-A915-9C3196C7A1DE.dat
const generateTestDataFile5 =
  generateDataFileFromLists.bind(null, [{ format: FilterFormat.STANDARD, data: 'ad_fr.png' }], 'rs-9852EFC4-99E4-4F2D-A915-9C3196C7A1DE.dat', 'test-data')

generateDataFilesForDefaultAdblock()
  .then(generateTestDataFile1)
  .then(generateTestDataFile2)
  .then(generateTestDataFile3)
  .then(generateTestDataFile4)
  .then(generateTestDataFile5)
  .then(generateDataFilesForAllRegions)
  .then(() => {
    console.log('Thank you for updating the data files, don\'t forget to upload them too!')
  })
  .catch((e) => {
    console.error(`Something went wrong, aborting: ${e}`)
    process.exit(1)
  })

process.on('uncaughtException', (err) => {
  console.error('Caught exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err)
  process.exit(1)
})
