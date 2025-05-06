import axios from 'axios';
import dotenv from 'dotenv';
import { fetchCoinGeckoPrices } from './coingeckoService';
dotenv.config();

const DEXSCREENER_API_URL = 'https://api.dexscreener.com';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
}

export interface TokenPriceInfo {
  usd: number | null;
  usd_24h_change: number | null;
  updatedAt: string | null;
  buys: number;
  sells: number;
  volume24h: number;
  swapAmount24h: number;
  lastSwapTime: string | null;
  pairs: string[];
  source?: 'coingecko' | 'dexscreener' | null;
}

export async function fetchPrices(contractAddresses: string[]): Promise<Record<string, TokenPriceInfo>> {
  const result: Record<string, TokenPriceInfo> = {};
  
  // First try to get prices from CoinGecko (one by one as per requirement)
  console.log('Fetching prices from CoinGecko...');
  const coinGeckoPrices = await fetchCoinGeckoPrices(contractAddresses);
  
  // Track which addresses we got prices for from CoinGecko
  const addressesWithCoinGeckoPrices = new Set<string>();
  let coingeckoSuccessCount = 0;
  
  // Initialize result with CoinGecko prices
  for (const [address, price] of coinGeckoPrices.entries()) {
    if (price !== null) {
      result[address] = {
        usd: price,
        usd_24h_change: null, // CoinGecko simple API doesn't provide 24h change in the endpoint we're using
        updatedAt: new Date().toISOString(),
        buys: 0,
        sells: 0,
        volume24h: 0,
        swapAmount24h: 0,
        lastSwapTime: null,
        pairs: [],
        source: 'coingecko'
      };
      addressesWithCoinGeckoPrices.add(address);
      coingeckoSuccessCount++;
    }
  }
  
  console.log(`Got prices for ${coingeckoSuccessCount} tokens from CoinGecko`);
  
  // For addresses without CoinGecko prices, fall back to DexScreener
  const addressesForDexScreener = contractAddresses
    .map(addr => addr.toLowerCase())
    .filter(addr => !addressesWithCoinGeckoPrices.has(addr));
  
  console.log(`Fetching prices from DexScreener for ${addressesForDexScreener.length} tokens...`);
  
  // DexScreener accepts up to 30 addresses per call, so batch addresses into chunks
  for (let i = 0; i < addressesForDexScreener.length; i += 30) {
    const chunk = addressesForDexScreener.slice(i, i + 30);
    const addressesParam = chunk.join(',');
    const url = `${DEXSCREENER_API_URL}/tokens/v1/seiv2/${addressesParam}`;
    
    try {
      const response = await axios.get<DexScreenerPair[]>(url);
      if (response.data && Array.isArray(response.data)) {
        response.data.forEach(pair => {
          if (pair.baseToken && pair.baseToken.address) {
            const address = pair.baseToken.address.toLowerCase();
            const priceUsd = pair.priceUsd ? parseFloat(pair.priceUsd) : null;
            const priceChange24h = pair.priceChange?.h24 || null;
            const h24Txns = pair.txns?.h24 || { buys: 0, sells: 0 };
            
            result[address] = { 
              usd: priceUsd, 
              usd_24h_change: priceChange24h,
              updatedAt: new Date().toISOString(),
              buys: h24Txns.buys,
              sells: h24Txns.sells,
              volume24h: pair.volume?.h24 || 0,
              swapAmount24h: 0,
              lastSwapTime: null,
              pairs: [],
              source: 'dexscreener'
            };
          }
        });
      }
    } catch (error) {
      console.error(`Error fetching prices for chunk ${addressesParam}:`, error);
    }
  }
  
  return result;
}