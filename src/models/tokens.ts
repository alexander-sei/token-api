import { Request } from 'express';

export interface TokenInfoResponseDto {
    sells: number;
    buys: number;
    swaps: number;
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

  export type OrderColumns = 
    | 'name'
    | 'symbol'
    | 'decimals'
    | 'contractAddress'
    | 'currentPrice'
    | 'priceUpdatedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'last24hVariation'
    | 'swaps'
    | 'sells'
    | 'buys';

  export interface TokensQueryParams {
    page?: number;
    limit?: number;
    addresses?: string;
    order?: OrderColumns;
    sort?: 'asc' | 'desc';
  }