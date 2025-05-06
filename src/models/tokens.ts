import { Request } from 'express';

export interface TokenInfoResponseDto {
    sells: number;
    buys: number;
    bondedAt: string | null;
  }
  export interface TokenResponseDto {
    name: string;
    symbol: string;
    decimals: number;
    logo: string;
    contractAddress: string;
    currentPrice: number | null;
    priceUpdatedAt: string;
    last24hVariation: number | null;
    priceSource?: 'coingecko' | 'dexscreener' | null;
    info: TokenInfoResponseDto;
  }
  export interface PageMetaDto {
    page: number;
    limit: number;
    totalItemsCount: number;
    pagesCount: number;
  }
  export interface TokenPageDto {
    data: TokenResponseDto[];
    meta: PageMetaDto;
  }

  export enum OrderColumns {
    NAME = 'name',
    SYMBOL = 'symbol',
    DECIMALS = 'decimals',
    CONTRACT_ADDRESS = 'contractAddress',
    PRICE = 'currentPrice',
    PRICE_UPDATED_AT = 'priceUpdatedAt',
    CREATED_AT = 'createdAt',
    UPDATED_AT = 'updatedAt',
    VARIATION = 'last24hVariation'
  }

  export interface TokensQueryParams {
    page?: number;
    limit?: number;
    isBonded?: boolean;
    isMostSwapped?: boolean;
    new?: boolean;
    addresses?: string;
    order?: OrderColumns;
    sort?: 'asc' | 'desc';
  }