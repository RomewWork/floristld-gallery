import Link from "next/link";
export default function Root() {
  return (
    <main className="redirect">
      <h1>Floristld</h1>
      <p>An illustrated world · 一个用画讲述的世界</p>
      <Link href="/zh/">进入画廊 →</Link>
      <Link href="/en/">Enter the gallery →</Link>
    </main>
  );
}
