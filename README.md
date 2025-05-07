# SEI Ecosystem Token API

A RESTful API service providing token information, pricing, and swap data for the SEI blockchain ecosystem.

## Features

- Token metadata and information retrieval
- Token pricing data from multiple sources
- Swap events tracking and analysis
- Pagination and filtering capabilities

## Tech Stack

- Node.js
- TypeScript
- Express.js
- Axios for API integrations

## Installation

```bash copy
# Clone the repository
git clone <repo-url>
cd sei-ecosystem-token-api

# Install dependencies
npm install
```

## Configuration

Create a `.env` file in the project root with the following variables:

``` bash copy
PORT=3000
# Add any other required environment variables
```

## Development

```bash copy
# Run in development mode with hot-reload
npm run dev
```

## Building and Running

```bash opy
# Build the project
npm run build

# Start the production server
npm start
```

## API Endpoints

### GET /tokens

Fetches a list of tokens with metadata, price information, and swap statistics.

Query Parameters:
- `page`: Page number (default: 1)
- `limit`: Number of items per page (default: 50, max: 100)
- `isBonded`: Filter for bonded tokens (boolean)
- `isMostSwapped`: Sort by most swapped tokens (boolean)
- `new`: Sort by most recently updated tokens (boolean)
- `addresses`: Comma-separated list of token addresses to filter by
- `order`: Field to sort by
- `sort`: Sort order (asc/desc, default: desc)

### GET /tokens/status

Returns the current status of the token data cache and data sources.

Response includes:
- Last refresh timestamp
- Cache age and status
- Total tokens count
- Last fetch details (success, timestamp, source counts)
- Health status
- Price source information

### GET /tokens/top-traded

Returns tokens sorted by trading activity (buys + sells).

Query Parameters:
- `page`: Page number (default: 1)
- `limit`: Number of items per page (default: 10, max: 100)
- `refresh`: Force a cache refresh (boolean)

## License

MIT 