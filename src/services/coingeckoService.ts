import axios, { AxiosError } from 'axios';
import { delay } from '../utils/common';

const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const CHAIN_ID = 'sei'; // Assuming Ethereum, adjust if needed

// Cache for CoinGecko prices to reduce API calls
const priceCache = new Map<string, { price: number | null, timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes (increased from 5)

// Rate limiting configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 10000; // 10 seconds

/**
 * Fetch token price from CoinGecko by contract address
 * @param contractAddress Ethereum contract address
 * @returns Price in USD or null if not available
 */
export async function fetchCoinGeckoPrice(contractAddress: string): Promise<number | null> {
  try {
    // Check cache first
    const normalizedAddress = contractAddress.toLowerCase();
    const cached = priceCache.get(normalizedAddress);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.price;
    }
    
    // Fetch from CoinGecko API with retries
    return await fetchWithRetry(normalizedAddress);
  } catch (error) {
    console.error(`Error fetching CoinGecko price for ${contractAddress}:`, error);
    return null;
  }
}

/**
 * Fetch price with exponential backoff retry logic
 */
async function fetchWithRetry(normalizedAddress: string, retryCount = 0): Promise<number | null> {
  try {
    const url = `${COINGECKO_API_BASE}/simple/token_price/${CHAIN_ID}`;
    const response = await axios.get(url, {
      params: {
        contract_addresses: normalizedAddress,
        vs_currencies: 'usd'
      }
    });
    
    // CoinGecko returns data in format: { "0x...": { "usd": 123.45 } }
    if (response.data && response.data[normalizedAddress] && response.data[normalizedAddress].usd) {
      const price = response.data[normalizedAddress].usd;
      // Update cache
      priceCache.set(normalizedAddress, { price, timestamp: Date.now() });
      return price;
    }
    
    // If token not found, cache null result to avoid repeated lookups
    priceCache.set(normalizedAddress, { price: null, timestamp: Date.now() });
    return null;
  } catch (error) {
    const axiosError = error as AxiosError;
    
    // Handle rate limit specifically
    if (axiosError.response?.status === 429) {
      if (retryCount < MAX_RETRIES) {
        // Calculate exponential backoff delay
        const backoffDelay = Math.min(
          INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
          MAX_RETRY_DELAY
        );
        
        console.log(`Rate limited by CoinGecko API. Retrying in ${backoffDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        
        // Wait using exponential backoff
        await delay(backoffDelay);
        
        // Retry the request
        return fetchWithRetry(normalizedAddress, retryCount + 1);
      } else {
        console.error(`Rate limit exceeded after ${MAX_RETRIES} retries for address ${normalizedAddress}`);
        
        // Return cached value even if expired, or null if none exists
        const cachedValue = priceCache.get(normalizedAddress);
        if (cachedValue) {
          console.log(`Using stale cache for ${normalizedAddress} due to rate limiting`);
          return cachedValue.price;
        }
      }
    }
    
    throw error;
  }
}

/**
 * Batch fetch CoinGecko prices for multiple tokens with rate limiting
 * Note: This fetches one by one due to API limitations as specified
 * @param addresses Array of token addresses
 * @returns Map of addresses to prices
 */
export async function fetchCoinGeckoPrices(addresses: string[]): Promise<Map<string, number | null>> {
  const prices = new Map<string, number | null>();
  
  // Process addresses one by one with a delay between requests to respect rate limits
  for (const address of addresses) {
    const price = await fetchCoinGeckoPrice(address);
    prices.set(address.toLowerCase(), price);
    
    // Add delay between requests to avoid rate limiting
    await delay(1500); // Increased from 500ms to 1.5s
  }
  
  return prices;
} 