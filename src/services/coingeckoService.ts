import axios, { AxiosError } from 'axios';
import { delay } from '../utils/common';

const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const CHAIN_ID = 'sei-v2';

// Cache for CoinGecko prices to reduce API calls
const priceCache = new Map<string, { price: number | null, timestamp: number }>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes (increased from 5)

// Rate limiting configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 10000; // 10 seconds
const MAX_IDS_PER_REQUEST = 100; // CoinGecko limit for ids per request

// Cache for contract address to CoinGecko ID mapping
type TokenInfo = {
  id: string;
  contractAddress: string;
};
let seiTokensMap: Map<string, TokenInfo> | null = null;
let lastTokenListFetch = 0;
const TOKEN_LIST_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Fetch the list of all sei-v2 tokens from CoinGecko
 * This populates a map of contract addresses to CoinGecko IDs
 */
async function fetchSeiTokensList(): Promise<Map<string, TokenInfo>> {
  try {
    // Use cached version if available and not expired
    if (seiTokensMap && Date.now() - lastTokenListFetch < TOKEN_LIST_CACHE_DURATION) {
      return seiTokensMap;
    }

    console.log('Fetching sei-v2 tokens list from CoinGecko...');
    const response = await axios.get(`${COINGECKO_API_BASE}/coins/list`, {
      params: {
        include_platform: true,
        status: 'active'
      }
    });

    const tokensMap = new Map<string, TokenInfo>();
    
    // Filter for tokens that have sei-v2 platform entries
    for (const token of response.data) {
      if (token.platforms && token.platforms[CHAIN_ID]) {
        const contractAddress = token.platforms[CHAIN_ID].toLowerCase();
        tokensMap.set(contractAddress, {
          id: token.id,
          contractAddress: contractAddress
        });
      }
    }
    
    console.log(`Found ${tokensMap.size} tokens on ${CHAIN_ID} platform`);
    
    // Cache the result
    seiTokensMap = tokensMap;
    lastTokenListFetch = Date.now();
    
    return tokensMap;
  } catch (error) {
    console.error('Error fetching sei-v2 tokens list:', error);
    // Return empty map or cached version if available
    return seiTokensMap || new Map();
  }
}

/**
 * Fetch token price from CoinGecko by contract address
 * @param contractAddress sei-v2 contract address
 * @returns Price in USD or null if not available
 */
export async function fetchCoinGeckoPrice(contractAddress: string): Promise<number | null> {
  try {
    // Normalize address
    const normalizedAddress = contractAddress.toLowerCase();
    
    // Check cache first
    const cached = priceCache.get(normalizedAddress);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.price;
    }
    
    // Get tokens map if not already fetched
    const tokensMap = await fetchSeiTokensList();
    const tokenInfo = tokensMap.get(normalizedAddress);
    
    // If token not found in the list, cache null result
    if (!tokenInfo) {
      console.log(`Token with address ${normalizedAddress} not found in CoinGecko sei-v2 tokens list`);
      priceCache.set(normalizedAddress, { price: null, timestamp: Date.now() });
      return null;
    }
    
    // Fetch price using the coin ID
    return await fetchPriceById(tokenInfo.id, normalizedAddress);
  } catch (error) {
    console.error(`Error fetching CoinGecko price for ${contractAddress}:`, error);
    return null;
  }
}

/**
 * Fetch price by CoinGecko coin ID with retry logic
 */
async function fetchPriceById(coinId: string, normalizedAddress: string, retryCount = 0): Promise<number | null> {
  try {
    const url = `${COINGECKO_API_BASE}/simple/price`;
    const response = await axios.get(url, {
      params: {
        ids: coinId,
        vs_currencies: 'usd'
      }
    });
    
    // CoinGecko returns data in format: { "coin-id": { "usd": 123.45 } }
    if (response.data && response.data[coinId] && response.data[coinId].usd) {
      const price = response.data[coinId].usd;
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
        return fetchPriceById(coinId, normalizedAddress, retryCount + 1);
      } else {
        console.error(`Rate limit exceeded after ${MAX_RETRIES} retries for coin ID ${coinId}`);
        
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
 * Fetch with exponential backoff retry logic (legacy method)
 * @deprecated Use fetchPriceById instead
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
 * Batch fetch CoinGecko prices for multiple tokens using the coins/list API and batched price requests
 * @param addresses Array of token addresses
 * @returns Map of addresses to prices
 */
export async function fetchCoinGeckoPrices(addresses: string[]): Promise<Map<string, number | null>> {
  const prices = new Map<string, number | null>();
  const normalizedAddresses = addresses.map(addr => addr.toLowerCase());
  
  try {
    // First check cache for all addresses
    const uncachedAddresses: string[] = [];
    
    for (const address of normalizedAddresses) {
      const cached = priceCache.get(address);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        prices.set(address, cached.price);
      } else {
        uncachedAddresses.push(address);
      }
    }
    
    // If all prices were in cache, return early
    if (uncachedAddresses.length === 0) {
      return prices;
    }
    
    // Get tokens map
    const tokensMap = await fetchSeiTokensList();
    
    // Map addresses to coin IDs and track which coin ID maps to which address
    const coinIdToAddress = new Map<string, string>();
    const coinIdsToFetch: string[] = [];
    
    for (const address of uncachedAddresses) {
      const tokenInfo = tokensMap.get(address);
      if (tokenInfo) {
        coinIdsToFetch.push(tokenInfo.id);
        coinIdToAddress.set(tokenInfo.id, address);
      } else {
        // Token not found in the list, cache null result
        console.log(`Token with address ${address} not found in CoinGecko sei-v2 tokens list`);
        priceCache.set(address, { price: null, timestamp: Date.now() });
        prices.set(address, null);
      }
    }
    
    // If no valid coin IDs found, return early
    if (coinIdsToFetch.length === 0) {
      return prices;
    }
    
    // Split coin IDs into chunks to respect CoinGecko's limit
    const coinIdChunks = [];
    for (let i = 0; i < coinIdsToFetch.length; i += MAX_IDS_PER_REQUEST) {
      coinIdChunks.push(coinIdsToFetch.slice(i, i + MAX_IDS_PER_REQUEST));
    }
    
    // Fetch prices for each chunk with retries
    for (const [chunkIndex, chunk] of coinIdChunks.entries()) {
      try {
        // Add a delay between chunks to avoid rate limiting
        if (chunkIndex > 0) {
          await delay(1500);
        }
        
        const batchPrices = await fetchPricesForCoinIds(chunk);
        
        // Process results
        for (const coinId of Object.keys(batchPrices)) {
          const address = coinIdToAddress.get(coinId);
          if (address) {
            const price = batchPrices[coinId]?.usd || null;
            prices.set(address, price);
            priceCache.set(address, { price, timestamp: Date.now() });
          }
        }
      } catch (error) {
        console.error(`Error fetching batch prices for chunk ${chunkIndex}:`, error);
        // For failed batches, fall back to individual requests
        for (const coinId of chunk) {
          const address = coinIdToAddress.get(coinId);
          if (address) {
            try {
              const price = await fetchPriceById(coinId, address);
              prices.set(address, price);
            } catch (innerError) {
              console.error(`Failed individual price fetch for ${coinId}:`, innerError);
              prices.set(address, null);
            }
            await delay(1000); // Add delay between individual requests
          }
        }
      }
    }
    
    return prices;
  } catch (error) {
    console.error('Error in batch fetch operation:', error);
    
    // Fall back to individual fetches for any addresses not yet processed
    for (const address of normalizedAddresses) {
      if (!prices.has(address)) {
        try {
          const price = await fetchCoinGeckoPrice(address);
          prices.set(address, price);
        } catch (innerError) {
          console.error(`Failed individual fetch for ${address}:`, innerError);
          prices.set(address, null);
        }
      }
    }
    
    return prices;
  }
}

/**
 * Fetch prices for multiple coin IDs in a single request
 * @param coinIds Array of CoinGecko coin IDs
 * @param retryCount Current retry attempt
 * @returns Object mapping coin IDs to price data
 */
async function fetchPricesForCoinIds(coinIds: string[], retryCount = 0): Promise<Record<string, { usd: number }>> {
  try {
    const url = `${COINGECKO_API_BASE}/simple/price`;
    const response = await axios.get(url, {
      params: {
        ids: coinIds.join(','),
        vs_currencies: 'usd'
      }
    });
    
    return response.data;
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
        
        console.log(`Rate limited by CoinGecko API. Retrying batch in ${backoffDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        
        // Wait using exponential backoff
        await delay(backoffDelay);
        
        // Retry the request
        return fetchPricesForCoinIds(coinIds, retryCount + 1);
      }
    }
    
    throw error;
  }
} 