function SlackGlyph() {
  return (
    <svg viewBox="0 0 122.8 122.8" aria-hidden="true" className="h-5 w-5">
      <path
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
        fill="#E01E5A"
      />
      <path
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
        fill="#36C5F0"
      />
      <path
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
        fill="#2EB67D"
      />
      <path
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function App() {
  return (
    <div className="min-h-screen w-full grid place-items-center bg-[#f5f6f8] text-[#1a1d23] px-4">
      <main className="w-full max-w-[460px] rounded-[18px] border border-[#e6e8ec] bg-white px-10 py-11 text-center shadow-[0_20px_50px_-30px_rgba(17,24,39,0.22)]">
        <div className="mb-[18px] text-[13px] font-medium uppercase tracking-[0.28em] text-[#9aa1ad]">
          Alex · Editorial AI
        </div>
        <h1 className="mb-3 text-[28px] font-semibold leading-[1.2]">
          Add Alex to your Slack
        </h1>
        <p className="mb-7 text-[15px] leading-[1.6] text-[#5b6471]">
          Alex is your on-brand editorial teammate. Install it, then spend two
          minutes teaching Alex your voice — and start creating.
        </p>
        <a
          href="/api/slack/install"
          className="inline-flex items-center gap-[10px] rounded-[10px] bg-[#11151c] px-[22px] py-[13px] text-[15px] font-semibold text-white no-underline transition-transform duration-100 hover:-translate-y-px"
        >
          <SlackGlyph />
          <span>Add to Slack</span>
        </a>
        <div className="mt-[26px] text-[13px] text-[#9aa1ad]">
          You'll be asked to approve permissions in your own Slack workspace.
        </div>
      </main>
    </div>
  );
}

export default App;
