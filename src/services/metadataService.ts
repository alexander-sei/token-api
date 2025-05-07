import fs from 'fs';
import csv from 'csv-parser';
export interface TokenMetadata { contract_address: string; symbol: string; name: string; decimals: number; }
let tokenMetadata: TokenMetadata[] = [];
export function loadTokenMetadata(): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.createReadStream('data/sei_all_tokens_no_dup_CA_or_name.csv')
      .pipe(csv())
      .on('data', row => {
        tokenMetadata.push({
          contract_address: row.contract_address.toLowerCase(),
          symbol: row.symbol,
          name: row.name,
          decimals: Number(row.decimals)
        });
      })
      .on('end', () => resolve())
      .on('error', reject);
  });
}
export function getTokenMetadata(address: string) {
  return tokenMetadata.find(t => t.contract_address === address.toLowerCase()) || null;
}

export function getAllTokenAddresses(): string[] {
  return tokenMetadata.map(token => token.contract_address);
}