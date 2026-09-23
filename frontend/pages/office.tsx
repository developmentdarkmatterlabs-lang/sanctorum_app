import Head from 'next/head';
import dynamic from 'next/dynamic';

// Canvas + image loading are browser-only; skip SSR entirely.
const OfficeModule = dynamic(() => import('@/modules/OfficeModule'), { ssr: false });

export default function OfficePage() {
  return (
    <>
      <Head>
        <title>Sanctorum — Office</title>
      </Head>
      <OfficeModule />
    </>
  );
}
