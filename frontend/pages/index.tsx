import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';

// Floors and agents now live in the database, so this page cannot count them
// without the backend — and it should render on its own. The tagline stays
// count-free; the office itself shows the live numbers.
const TAGLINE = 'A tower of agents, connected by portals.';

export default function Home() {
  return (
    <>
      <Head>
        <title>Sanctorum</title>
      </Head>

      <main className="relative flex min-h-screen flex-col items-center justify-end overflow-hidden bg-[#0b0d10] px-6 pb-[8vh]">
        <Image
          src="/assets/floor/images/entrance.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          quality={90}
          className="object-cover object-center"
        />

        {/* Scrim: the art is already dark at the edges, so this only needs to
            hold the copy legible over the carpet. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/25"
        />

        <div className="relative flex flex-col items-center gap-6 text-center">
          <h1 className="font-mono text-5xl font-bold tracking-[0.14em] text-[#f0a832] drop-shadow-[0_2px_12px_rgba(0,0,0,.9)] sm:text-6xl">
            SANCTORUM
          </h1>

          {/* Floors are derived; the agent count is not stated, since it lives
              in the database and this page does not need the backend. */}
          <p className="max-w-md font-mono text-sm leading-relaxed text-[#d7dde6] drop-shadow-[0_1px_8px_rgba(0,0,0,.9)]">
            {TAGLINE}
          </p>

          <Link
            href="/office"
            className="rounded border border-[#f0a832]/70 bg-black/40 px-6 py-3 font-mono text-sm tracking-wide text-[#f0a832] backdrop-blur-sm transition-colors hover:border-[#f0a832] hover:bg-[#f0a832]/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0a832]"
          >
            Enter the office →
          </Link>
        </div>
      </main>
    </>
  );
}
