import type { NextApiRequest, NextApiResponse } from 'next';

// OAuth callback. Exchange the authorization code for tokens here.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(501).json({ error: 'Not implemented' });
}
