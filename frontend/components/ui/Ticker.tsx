export default function Ticker({ text }: { text: string }) {
  return (
    <div className="flex-1 overflow-hidden whitespace-nowrap text-[var(--content-secondary)]">
      <span className="office-ticker inline-block pl-[100%]">{text}</span>
    </div>
  );
}
