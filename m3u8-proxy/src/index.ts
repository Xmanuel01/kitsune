import express from 'express';
import morgan from 'morgan';
import cors from 'cors';

import indexRouter from './routes/index';
import proxyRouter from './routes/fetch';

const app = express();

app.use(express.json());

app.set('trust proxy', true); // this is for if you're behind a load balancer or a reverse proxy

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600,
}));

app.use(morgan('combined'));

app.use('/', indexRouter);

app.use('/fetch', proxyRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
