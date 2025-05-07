import fs from 'fs';
import csv from 'csv-parser';

export interface TokenMetadata {
  contract_address: string;
  name: string;
  symbol: string;
  decimals: number;
  logo?: string;
}

let tokenMetadata: TokenMetadata[] = [];

export function loadTokenMetadata(): Promise<void> {
  return new Promise((resolve, reject) => {
    const results: TokenMetadata[] = [];
    fs.createReadStream('data/sei_all_tokens_no_dup_CA_or_name.csv')
      .pipe(csv())
      .on('data', (data: TokenMetadata) => results.push(data))
      .on('end', () => {
        tokenMetadata = results;
        resolve();
      })
      .on('error', reject);
  });
}

export function getTokenMetadata(address: string): TokenMetadata | undefined {
  return tokenMetadata.find(t => t.contract_address.toLowerCase() === address.toLowerCase());
}

export function getAllTokenAddresses(): string[] {
  return tokenMetadata.map(t => t.contract_address);
}