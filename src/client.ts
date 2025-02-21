'use client'

import { DateTime } from 'luxon'
import * as duckdb from '@duckdb/duckdb-wasm'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdb_wasm_next from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

const MANUAL_BUNDLES = {
    mvp: {
        mainModule: duckdb_wasm,
        mainWorker: mvp_worker,
    },
    eh: {
        mainModule: duckdb_wasm_next,
        mainWorker: eh_worker
    },
}

// DuckDB WASM
let db: duckdb.AsyncDuckDB | null = null
let conn: duckdb.AsyncDuckDBConnection | null = null
let stmt: duckdb.AsyncPreparedStatement | null = null

// Query
const query = `
    -- (1) Get records where shownotes contain the keyword
    SELECT E.id AS e_id,
        E.title AS e_title,
        E.link AS e_link,
        E.pubDate,
        S.id AS s_id,
        S.title AS s_title,
        S.link AS s_link
    FROM Episodes E
    JOIN Shownotes S ON E.id = S.episodeId
    WHERE S.title LIKE '%' || ? || '%'

    UNION ALL

    -- (2) Get records where only episodes contain the keyword (no matching shownotes)
    SELECT E.id AS e_id,
        E.title AS e_title,
        E.link AS e_link,
        E.pubDate,
        NULL AS s_id,
        NULL AS s_title,
        NULL AS s_link
    FROM Episodes E
    WHERE E.title LIKE '%' || ? || '%'
    AND NOT EXISTS (
        SELECT 1 FROM Shownotes S
        WHERE S.episodeId = E.id
            AND S.title LIKE '%' || ? || '%'
    )
    ORDER BY E.pubDate DESC;
`

// Type definition
type Shownote = {
    title: string | null,
    link: string | null
}

type Episode = {
    title: string,
    link: string,
    pubDate: string,
    shownotes: Shownote[]
}

export async function initDB() {
    if (typeof window === 'undefined') return

    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES)
    const worker = new Worker(bundle.mainWorker!)
    const logger = new duckdb.ConsoleLogger()
    
    db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    
    conn = await db.connect()
    
    if (import.meta.env.PROD) {
        await conn.query(`
            CREATE TABLE Episodes AS SELECT * FROM read_parquet('https://raw.githubusercontent.com/tamanishi/check-ossanfm-feed/refs/heads/main/Episodes.parquet');
            CREATE TABLE Shownotes AS SELECT * FROM read_parquet('https://raw.githubusercontent.com/tamanishi/check-ossanfm-feed/refs/heads/main/Shownotes.parquet');
        `)
    } else {
        await conn.query(`
            CREATE TABLE Episodes AS SELECT * FROM read_parquet('http://localhost:5173/static/episodes.parquet');
            CREATE TABLE Shownotes AS SELECT * FROM read_parquet('http://localhost:5173/static/shownotes.parquet');
        `)
    }

    // Keep statement
    stmt = await conn.prepare(query)

    // Show all records on initial load
    await search()
}

export async function search() {
    if (!stmt) {
        await initDB()
        if (!stmt) return
    }

    try {
        // Get search input value
        const keyword = document.getElementById('keyword') as HTMLInputElement
        const keywordValue = keyword?.value || ''

        // Execute query with empty string to show all records if no keyword
        const episodes = await stmt.query(keywordValue, keywordValue, keywordValue)
        const results = episodes.toArray()

        // Create episode map
        let episodeMap = new Map<number, Episode>()
        results.forEach(e => {
            if (episodeMap.has(e['e_id'])) {
                if (e['s_id'] === null) {
                    // Skip if parent element exists but no shownote elements
                    return
                } else {
                    // Add shownote if parent element exists and has elements
                    let episode = episodeMap.get(e['e_id'])
                    const shownote: Shownote = {
                        title: e['s_title'],
                        link: e['s_link'],
                    }
                    episode!.shownotes.push(shownote)
                    episodeMap.set(e['e_id'], episode!)
                }
            } else {
                // Add new episode if parent doesn't exist (with or without elements)
                let episode: Episode = {
                    title: e['e_title'],
                    link: e['e_link'],
                    pubDate: e['pubDate'],
                    shownotes: []
                }
                if (e['s_id'] !== null) {
                    const shownote: Shownote = {
                        title: e['s_title'],
                        link: e['s_link'],
                    }
                    episode.shownotes.push(shownote)
                }
                episodeMap.set(e['e_id'], episode)
            }
        })

        // Convert results to HTML format for display
        const resultsHTML = Array.from(episodeMap.values()).map(episode => {
            const regex = new RegExp(`${keywordValue}`, 'gi')
            const marked_title = keywordValue === '' ? 
                episode.title : 
                episode.title.replace(regex, '<mark>$&</mark>')
            const pubDate = DateTime.fromISO(episode.pubDate).toFormat('yyyy/LL/dd')

            const shownotesHTML = episode.shownotes
                .filter(s => s.title !== null)
                .map(shownote => {
                    const marked_shownote = keywordValue === '' ? 
                        shownote.title : 
                        shownote.title!.replace(regex, '<mark>$&</mark>')
                    return `
                        <li class="whitespace-nowrap mx-3 marker:text-blue-400">
                            <a class="inline-block text-blue-400 hover:underline" 
                               href="${shownote.link}" target="_blank">
                                <div>${marked_shownote}</div>
                            </a>
                        </li>`
                }).join('')

            return `
                <div class="my-3">
                    <h2 class="text-xl text-blue-400 inline-block">
                        <a class="hover:underline" href="${episode.link}" target="_blank">
                            <div>${marked_title}</div>
                        </a>
                    </h2>
                    <span class="ml-2 text-gray-400">(${pubDate})</span>
                    <ul class="list-inside list-disc">
                        ${shownotesHTML}
                    </ul>
                </div>
            `
        }).join('')

        // Write results to DOM
        const searchResults = document.getElementById('search-results')
        if (searchResults) {
            searchResults.innerHTML = resultsHTML
        }
    } catch (error) {
        console.error('Query failed:', error)
        const searchResults = document.getElementById('search-results')
        if (searchResults) {
            searchResults.innerHTML = '<p class="text-red-500">An error occurred during search</p>'
        }
    }
}

// Add cleanup function
export async function cleanup() {
    if (stmt) await stmt.close()
    if (conn) await conn.close()
    if (db) await db.terminate()
}

// Register functions globally
if (typeof window !== 'undefined') {
    window.search = search

    // Initialize on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
        initDB().catch(console.error)

        // Add event listener to search input field
        const keyword = document.getElementById('keyword')
        keyword?.addEventListener('input', () => {
            search().catch(console.error)
        })
    })

    // Execute cleanup on page unload
    window.addEventListener('beforeunload', () => {
        cleanup().catch(console.error)
    })
}

declare global {
    interface Window {
        search: typeof search;
    }
}
