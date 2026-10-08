import { useState } from 'react'

function Versions(): React.JSX.Element {
  const [versions] = useState(window.electron?.process.versions)

  if (!versions) return <span className="text-[11px] text-neutral-400">Browser preview</span>

  return (
    <ul className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-mono text-neutral-400">
      <li className="px-3 py-1 bg-neutral-900 border border-neutral-850 rounded-full hover:border-neutral-700 hover:text-neutral-200 transition-colors duration-200">
        Electron v{versions.electron}
      </li>
      <li className="px-3 py-1 bg-neutral-900 border border-neutral-850 rounded-full hover:border-neutral-700 hover:text-neutral-200 transition-colors duration-200">
        Chromium v{versions.chrome}
      </li>
      <li className="px-3 py-1 bg-neutral-900 border border-neutral-850 rounded-full hover:border-neutral-700 hover:text-neutral-200 transition-colors duration-200">
        Node v{versions.node}
      </li>
    </ul>
  )
}

export default Versions
