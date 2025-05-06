import express from 'express';
import dotenv from 'dotenv';
import { tokensRouter } from './routes/tokens';
import { loadTokenMetadata } from './services/metadataService';

dotenv.config();
const app = express();
app.use(express.json());

// Preload token metadata
loadTokenMetadata().catch(console.error);

app.use(tokensRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});