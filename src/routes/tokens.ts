import express from 'express';
import { fetchSwapEvents, fetchAllSwapEvents } from '../services/duneService';
import { fetchPrices, TokenPriceInfo } from '../services/priceService';
import { loadTokenMetadata, getTokenMetadata, getAllTokenAddresses } from '../services/metadataService';
import { getPagination } from '../utils/pagination';
import { TokenResponseDto, TokenPageDto, TokensQueryParams, OrderColumns } from '../models/tokens';

export const tokensRouter = express.Router();

// Configuration
const CONFIG = {
  FILTER_TOKENS_WITHOUT_DATA: true, // Set to false to include all tokens, even those with no data
  CACHE_DURATION: 5 * 60 * 1000 // 5 minutes in milliseconds
};

// Cache variables
let cachedTokenData: TokenResponseDto[] = [];
let lastFetchTime: number = 0;
const CACHE_DURATION = CONFIG.CACHE_DURATION;
let metadataLoaded = false;
let isCurrentlyLoading = false; // Flag to track if data is currently being loaded

// Status tracking
let lastFetchStatus = {
  success: false,
  timestamp: 0,
  error: null as Error | null,
  duneEventsCount: 0,
  dexScreenerTokensCount: 0,
  coinGeckoTokensCount: 0,
  totalTokensProcessed: 0
};

// Function to check if cache needs refresh
const shouldRefreshCache = (): boolean => {
  const now = Date.now();
  return now - lastFetchTime > CACHE_DURATION || cachedTokenData.length === 0;
};

// Function to fetch and process all token data
async function fetchAndProcessTokenData() {
  if (isCurrentlyLoading) {
    console.log('Data is already being loaded, waiting for completion...');
    return cachedTokenData; // Return current data while loading
  }

  isCurrentlyLoading = true;
  // Reset status
  lastFetchStatus = {
    success: false,
    timestamp: Date.now(),
    error: null,
    duneEventsCount: 0,
    dexScreenerTokensCount: 0,
    coinGeckoTokensCount: 0,
    totalTokensProcessed: 0
  };

  try {
    // Load metadata if not loaded
    if (!metadataLoaded) {
      await loadTokenMetadata();
      metadataLoaded = true;
    }

    console.log('----------------- DATA SOURCE DEBUG -----------------');
    
    // Fetch all swap events with pagination
    const events = await fetchAllSwapEvents();
    lastFetchStatus.duneEventsCount = events.length;
    console.log(`Fetched ${events.length} swap events from Dune`);

    // Store additional Dune data for internal use
    const duneExtendedData = new Map<string, { 
      totalAmountUsd: number;
      lastSwapTime: string | null;
      pairs: Set<string>;
    }>();

    // Group events by token address to compute sells/buys
    const grouped = new Map<string, { sells: number; buys: number }>();
    for (const e of events) {
      // Validate all required fields
      if (!e.token_sold_address || !e.token_bought_address || !e.block_time) {
        console.log('Skipping event with missing required fields');
        continue;
      }

      // Normalize addresses to lowercase and trim whitespace
      const sellAddr = e.token_sold_address.toLowerCase().trim();
      const buyAddr = e.token_bought_address.toLowerCase().trim();
      
      // Update sell/buy counts
      const sellData = grouped.get(sellAddr) || { sells: 0, buys: 0 };
      sellData.sells += 1;
      grouped.set(sellAddr, sellData);

      const buyData = grouped.get(buyAddr) || { sells: 0, buys: 0 };
      buyData.buys += 1;
      grouped.set(buyAddr, buyData);
      
      // Collect extended data for internal use
      // Sell token
      let sellExtData = duneExtendedData.get(sellAddr) || { 
        totalAmountUsd: 0, 
        lastSwapTime: null, 
        pairs: new Set<string>() 
      };
      
      // Use default 0 if amount_usd is undefined or null
      sellExtData.totalAmountUsd += Number(e.amount_usd) || 0;
      if (!sellExtData.lastSwapTime || new Date(e.block_time) > new Date(sellExtData.lastSwapTime)) {
        sellExtData.lastSwapTime = e.block_time;
      }
      if (e.token_pair) {
        sellExtData.pairs.add(e.token_pair);
      }
      duneExtendedData.set(sellAddr, sellExtData);
      
      // Buy token
      let buyExtData = duneExtendedData.get(buyAddr) || { 
        totalAmountUsd: 0, 
        lastSwapTime: null, 
        pairs: new Set<string>() 
      };
      
      buyExtData.totalAmountUsd += Number(e.amount_usd) || 0;
      if (!buyExtData.lastSwapTime || new Date(e.block_time) > new Date(buyExtData.lastSwapTime)) {
        buyExtData.lastSwapTime = e.block_time;
      }
      if (e.token_pair) {
        buyExtData.pairs.add(e.token_pair);
      }
      duneExtendedData.set(buyAddr, buyExtData);
    }

    console.log('Total unique token addresses from Dune:', grouped.size);
    
    // Get all token addresses
    const addresses = getAllTokenAddresses();
    console.log(`Processing ${addresses.length} tokens`);
    
    // Fetch prices
    const prices = await fetchPrices(addresses);
    lastFetchStatus.dexScreenerTokensCount = Object.keys(prices).length;

    // Count how many tokens have CoinGecko prices
    lastFetchStatus.coinGeckoTokensCount = Object.values(prices)
      .filter(priceInfo => priceInfo.source === 'coingecko')
      .length;

    console.log(`Fetched prices for ${Object.keys(prices).length} tokens (${lastFetchStatus.coinGeckoTokensCount} from CoinGecko)`);

    // Source attribution stats
    let duneContributionCount = 0;
    let dexScreenerContributionCount = 0;
    let coinGeckoContributionCount = 0;
    let bothSourcesCount = 0;

    // Store rich token data for internal use (not exposed in API)
    const tokenExtendedData = new Map<string, {
      volume24h: number;
      swapAmount24h: number;
      lastSwapTime: string | null;
      pairs: string[];
    }>();

    const allTokenData: TokenResponseDto[] = addresses.map((addr: string) => {
      const normalizedAddr = addr.toLowerCase().trim();
      const meta = getTokenMetadata(normalizedAddr);
      const priceInfo: TokenPriceInfo = prices[normalizedAddr] || { 
        usd: null, 
        usd_24h_change: null, 
        updatedAt: null,
        buys: 0,
        sells: 0,
        volume24h: 0,
        swapAmount24h: 0,
        lastSwapTime: null,
        pairs: [],
        source: null
      };
      
      // Combine swap data from Dune with data from DexScreener
      const swapInfo = grouped.get(normalizedAddr) || { sells: 0, buys: 0 };
      
      const totalSells = (priceInfo.sells || 0) + swapInfo.sells;
      const totalBuys = (priceInfo.buys || 0) + swapInfo.buys;
      
      // Debug: Log source attribution for this token
      const hasDuneData = swapInfo.sells > 0 || swapInfo.buys > 0;
      const hasDexScreenerData = priceInfo.usd !== null || priceInfo.sells > 0 || priceInfo.buys > 0;
      const hasCoinGeckoPrice = priceInfo.source === 'coingecko';
      
      if (hasDuneData && (hasDexScreenerData || hasCoinGeckoPrice)) {
        bothSourcesCount++;
      } else if (hasDuneData) {
        duneContributionCount++;
      } else if (hasCoinGeckoPrice) {
        coinGeckoContributionCount++;
      } else if (hasDexScreenerData) {
        dexScreenerContributionCount++;
      }
      
      const symbolOrAddr = meta?.symbol || normalizedAddr.substring(0, 8) + '...';
      console.log(`Token ${symbolOrAddr}:`, {
        dune: hasDuneData ? {
          sells: swapInfo.sells,
          buys: swapInfo.buys,
          lastSwapTime: duneExtendedData.get(normalizedAddr)?.lastSwapTime || null,
          pairsCount: duneExtendedData.get(normalizedAddr)?.pairs.size || 0,
          totalAmountUsd: duneExtendedData.get(normalizedAddr)?.totalAmountUsd || 0
        } : 'No data',
        priceSource: priceInfo.source || 'unknown',
        priceData: priceInfo.usd !== null ? {
          price: priceInfo.usd,
          priceChange24h: priceInfo.usd_24h_change,
          sells: priceInfo.sells || 0,
          buys: priceInfo.buys || 0,
          volume24h: priceInfo.volume24h || 0,
          swapAmount24h: priceInfo.swapAmount24h || 0,
          pairsCount: priceInfo.pairs?.length || 0
        } : 'No price data'
      });
      
      // Combine additional data for internal use
      const duneData = duneExtendedData.get(normalizedAddr) || { 
        totalAmountUsd: 0, 
        lastSwapTime: null, 
        pairs: new Set<string>() 
      };
      
      // Store the extended data for potential future use
      tokenExtendedData.set(normalizedAddr, {
        volume24h: priceInfo.volume24h || 0,
        swapAmount24h: (priceInfo.swapAmount24h || 0) + duneData.totalAmountUsd,
        lastSwapTime: duneData.lastSwapTime || priceInfo.lastSwapTime,
        pairs: [...new Set([...(priceInfo.pairs || []), ...[...duneData.pairs]])]
      });

      // Return only the standard response structure without extended data
      return {
        name: meta?.name || addr,
        symbol: meta?.symbol || addr,
        decimals: meta?.decimals || 0,
        logo: '', // Default empty logo
        contractAddress: addr,
        currentPrice: priceInfo.usd,
        priceUpdatedAt: priceInfo.updatedAt || new Date().toISOString(),
        last24hVariation: priceInfo.usd_24h_change ?? 0,
        info: {
          sells: totalSells,
          buys: totalBuys,
          bondedAt: null // This would need to be updated with actual bonding data if available
        }
      };
    });

    // Filter out tokens with no data from any source
    let filteredTokenData = allTokenData;
    if (CONFIG.FILTER_TOKENS_WITHOUT_DATA) {
      filteredTokenData = allTokenData.filter(token => {
        const addr = token.contractAddress.toLowerCase();
        const hasDuneData = grouped.has(addr) && (grouped.get(addr)!.sells > 0 || grouped.get(addr)!.buys > 0);
        const hasPriceData = prices[addr] && (
          prices[addr].usd !== null || 
          prices[addr].sells > 0 || 
          prices[addr].buys > 0
        );
        return hasDuneData || hasPriceData;
      });
      console.log(`Filtered out ${allTokenData.length - filteredTokenData.length} tokens with no data`);
    } else {
      console.log("Token filtering is disabled, keeping all tokens");
    }

    // Log data source summary
    console.log('------- DATA SOURCE SUMMARY -------');
    console.log(`Tokens with Dune data only: ${duneContributionCount}`);
    console.log(`Tokens with DexScreener data only: ${dexScreenerContributionCount}`);
    console.log(`Tokens with CoinGecko price data: ${coinGeckoContributionCount}`);
    console.log(`Tokens with data from multiple sources: ${bothSourcesCount}`);
    if (CONFIG.FILTER_TOKENS_WITHOUT_DATA) {
      console.log(`Tokens with no data (filtered out): ${allTokenData.length - filteredTokenData.length}`);
    } else {
      console.log(`Tokens with no data: ${addresses.length - (duneContributionCount + dexScreenerContributionCount + coinGeckoContributionCount + bothSourcesCount)}`);
    }
    console.log(`Total tokens after filtering: ${filteredTokenData.length}`);
    console.log('-----------------------------------');
    console.log(`Cache refreshed at: ${new Date().toISOString()}`);

    // Update status
    lastFetchStatus.success = true;
    lastFetchStatus.totalTokensProcessed = filteredTokenData.length;
    
    return filteredTokenData;
  } catch (error) {
    console.error('Error in fetchAndProcessTokenData:', error);
    lastFetchStatus.error = error as Error;
    throw error;
  } finally {
    isCurrentlyLoading = false;
  }
}

// Initialize the cache with an immediate fetch
fetchAndProcessTokenData().then(data => {
  cachedTokenData = data;
  lastFetchTime = Date.now();
  isCurrentlyLoading = false;
  console.log('Initial token data cache populated');
}).catch(error => {
  console.error('Failed to initialize token data cache:', error);
  isCurrentlyLoading = false;
});

// Set up automatic refresh every 5 minutes
setInterval(async () => {
  try {
    if (!isCurrentlyLoading) {
      console.log('Auto refresh: refreshing token data...');
      cachedTokenData = await fetchAndProcessTokenData();
      lastFetchTime = Date.now();
      console.log('Auto refresh completed at:', new Date().toISOString());
    } else {
      console.log('Auto refresh: data refresh already in progress, skipping');
    }
  } catch (error) {
    console.error('Auto refresh: error refreshing token data:', error);
  }
}, CACHE_DURATION);

tokensRouter.get('/tokens', async (req, res) => {
  try {
    // With auto-refresh enabled, we just use the cached data
    if (isCurrentlyLoading) {
      console.log('Data refresh in progress, using current cached data');
    } else {
      console.log('Using cached token data, last refreshed:', new Date(lastFetchTime).toISOString());
    }

    // Parse query parameters
    const query: TokensQueryParams = {
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 50, 100),
      isBonded: req.query.isBonded === 'true',
      isMostSwapped: req.query.isMostSwapped === 'true',
      new: req.query.new === 'true',
      addresses: req.query.addresses as string,
      order: req.query.order as OrderColumns,
      sort: (req.query.sort as 'asc' | 'desc') || 'desc'
    };

    // Ensure numbers for pagination
    const pageNum = query.page || 1;
    const limitNum = query.limit || 50;
    const { offset } = getPagination(pageNum, limitNum);

    // Filter data from cached tokens
    let data = [...cachedTokenData]; // Create a copy to avoid modifying the cache
    
    // Filter by addresses if specified
    if (query.addresses) {
      const addressFilter = query.addresses.split(',').map(a => a.trim().toLowerCase());
      data = data.filter(token => addressFilter.includes(token.contractAddress.toLowerCase()));
    }

    // Apply filters based on query parameters
    if (query.isBonded) {
      data = data.filter(token => token.info.bondedAt !== null);
    }

    if (query.isMostSwapped) {
      // Calculate total swaps for each token
      const tokenSwaps = data.map(token => ({
        token,
        totalSwaps: token.info.buys + token.info.sells
      }));

      // Sort by swap count
      tokenSwaps.sort((a, b) => b.totalSwaps - a.totalSwaps);
      
      // Take only the top 25% most swapped tokens (at least 1)
      const topCount = Math.max(1, Math.ceil(tokenSwaps.length * 0.25));
      data = tokenSwaps.slice(0, topCount).map(item => item.token);
    }

    if (query.new) {
      // Filter tokens created/updated within the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      data = data.filter(token => {
        if (!token.priceUpdatedAt) return false;
        const updatedAt = new Date(token.priceUpdatedAt);
        return updatedAt >= sevenDaysAgo;
      });
    }

    // Apply ordering if specified
    if (query.order) {
      data = data.sort((a, b) => {
        const orderKey = query.order as keyof TokenResponseDto;
        if (!orderKey) return 0;
        
        const valA: any = a[orderKey];
        const valB: any = b[orderKey];
        
        if (valA === null) return 1;
        if (valB === null) return -1;
        
        if (typeof valA === 'string' && typeof valB === 'string') {
          return query.sort === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
          return query.sort === 'asc' ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
        }
      });
    }

    // Apply pagination
    const start = offset;
    const end = offset + limitNum;
    const paginatedData = data.slice(start, end);

    const totalItemsCount = data.length;
    const pagesCount = Math.ceil(totalItemsCount / limitNum);
    const result: TokenPageDto = { 
      data: paginatedData, 
      meta: { 
        page: pageNum, 
        limit: limitNum, 
        totalItemsCount, 
        pagesCount 
      } 
    };

    res.json(result);
  } catch (error) {
    console.error('Error in /tokens endpoint:', error);
    res.status(500).json({ error: 'Failed to fetch token data' });
  }
});

// Add status endpoint
tokensRouter.get('/tokens/status', async (req, res) => {
  const now = Date.now();
  const cacheAge = now - lastFetchTime;
  
  const status = {
    last_refresh: new Date(lastFetchTime).toISOString(),
    cache_age_seconds: Math.floor(cacheAge / 1000),
    cache_status: cacheAge < CACHE_DURATION ? 'fresh' : 'stale',
    total_tokens: cachedTokenData.length,
    last_fetch: {
      success: lastFetchStatus.success,
      timestamp: new Date(lastFetchStatus.timestamp).toISOString(),
      error: lastFetchStatus.error ? lastFetchStatus.error.message : null,
      dune_events_count: lastFetchStatus.duneEventsCount,
      dexscreener_tokens_count: lastFetchStatus.dexScreenerTokensCount,
      coingecko_tokens_count: lastFetchStatus.coinGeckoTokensCount,
      total_tokens_processed: lastFetchStatus.totalTokensProcessed,
      tokens_filtered_out: lastFetchStatus.totalTokensProcessed > 0 ? 
        lastFetchStatus.totalTokensProcessed - cachedTokenData.length : 0
    },
    health: lastFetchStatus.success ? 'healthy' : 'degraded',
    price_sources: {
      coingecko: {
        enabled: true,
        priority: 1,
        description: "Primary source for token prices, called individually per token"
      },
      dexscreener: {
        enabled: true, 
        priority: 2,
        description: "Fallback source when CoinGecko data is unavailable"
      }
    }
  };
  
  res.json(status);
});

// Add top-traded endpoint
tokensRouter.get('/tokens/top-traded', async (req, res) => {
  try {
    // With auto-refresh enabled, we just use the cached data
    if (isCurrentlyLoading) {
      console.log('Data refresh in progress, using current cached data for top-traded endpoint');
    } else {
      console.log('Using cached token data for top-traded endpoint, last refreshed:', new Date(lastFetchTime).toISOString());
    }
    
    // Parse query parameters
    const pageNum = Number(req.query.page) || 1;
    const limitNum = Math.min(Number(req.query.limit) || 10, 100);
    const { offset } = getPagination(pageNum, limitNum);
    
    // Sort by most swapped
    const sortedData = [...cachedTokenData].sort(
      (a, b) => (b.info.buys + b.info.sells) - (a.info.buys + a.info.sells)
    );
    
    // Apply pagination
    const paginatedData = sortedData.slice(offset, offset + limitNum);
    
    const totalItemsCount = sortedData.length;
    const pagesCount = Math.ceil(totalItemsCount / limitNum);
    
    const result: TokenPageDto = {
      data: paginatedData,
      meta: {
        page: pageNum,
        limit: limitNum,
        totalItemsCount,
        pagesCount
      }
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error in /tokens/top-traded endpoint:', error);
    res.status(500).json({ error: 'Failed to fetch top traded tokens' });
  }
});