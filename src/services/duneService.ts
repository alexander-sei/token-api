import axios from 'axios';
require('dotenv').config();

const DUNE_API_KEY = process.env.DUNE_API_KEY!;
const DUNE_QUERY_ID = process.env.DUNE_QUERY_ID!;

// Maximum number of retries for API calls
const MAX_RETRIES = 3;
// Delay between retries (in ms)
const RETRY_DELAY = 1000;

export interface SwapEvent {
  token_sold_address: string;
  token_bought_address: string;
  // Additional fields from Dune API
  amount_usd: number;
  token_bought_amount: number;
  token_sold_amount: number;
  token_bought_symbol: string;
  token_sold_symbol: string;
  block_time: string;
  tx_hash: string;
  token_pair: string | null;
}

/**
 * Validates that a SwapEvent object has all required fields
 */
function isValidSwapEvent(event: any): event is SwapEvent {
  return (
    event &&
    typeof event.token_sold_address === 'string' &&
    typeof event.token_bought_address === 'string' &&
    typeof event.block_time === 'string'
  );
}

/**
 * Fetches a single page of swap events from Dune API
 */
export async function fetchSwapEvents(limit: number, offset: number, retryCount = 0): Promise<SwapEvent[]> {
  try {
    const url = `https://api.dune.com/api/v1/query/${DUNE_QUERY_ID}/results?limit=${limit}&offset=${offset}`;
    console.log(`Fetching events from Dune: limit=${limit}, offset=${offset}`);
    
    const res = await axios.get(url, {
      headers: { 'X-Dune-API-Key': DUNE_API_KEY }
    });
    
    if (!res.data?.result?.rows || !Array.isArray(res.data.result.rows)) {
      console.error('Invalid response format from Dune API:', res.data);
      return [];
    }
    
    // Validate each row
    const validEvents = res.data.result.rows.filter(isValidSwapEvent);
    console.log(`Received ${res.data.result.rows.length} events, ${validEvents.length} valid`);
    
    return validEvents;
  } catch (error) {
    console.error(`Error fetching events from Dune (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, error);
    
    // Retry logic
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return fetchSwapEvents(limit, offset, retryCount + 1);
    }
    
    // If all retries fail, return empty array
    console.error('All retry attempts failed');
    return [];
  }
}

/**
 * Fetches all swap events with pagination
 */
export async function fetchAllSwapEvents(maxEvents = Infinity): Promise<SwapEvent[]> {
  const batchSize = 10000;
  let offset = 0;
  let allEvents: SwapEvent[] = [];
  let hasMore = true;
  let consecutiveEmptyPages = 0;
  
  console.log('Starting to fetch all swap events from Dune');
  
  while (hasMore && allEvents.length < maxEvents) {
    const events = await fetchSwapEvents(batchSize, offset);
    
    if (events.length === 0) {
      consecutiveEmptyPages++;
      // If we get 2 empty pages in a row, assume we've reached the end
      if (consecutiveEmptyPages >= 2) {
        hasMore = false;
      }
    } else {
      consecutiveEmptyPages = 0;
      allEvents = [...allEvents, ...events];
      offset += events.length;
      console.log(`Fetched ${events.length} events, total: ${allEvents.length}`);
      
      // If we got fewer events than requested, assume we've reached the end
      if (events.length < batchSize) {
        hasMore = false;
      }
    }
    
    // Enforce maxEvents limit
    if (allEvents.length >= maxEvents) {
      allEvents = allEvents.slice(0, maxEvents);
      hasMore = false;
    }
  }
  
  console.log(`Completed fetching events from Dune. Total events: ${allEvents.length}`);
  return allEvents;
}