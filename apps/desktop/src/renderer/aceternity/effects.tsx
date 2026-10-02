/** Aceternity 风格的静态装饰：无动画库、鼠标追踪或永久合成层。 */

/** 全应用极光氛围背景：三团主题色光晕 + 透视网格，固定于界面最底层。 */
export function AuroraBackdrop() {
  return (
    <div className="bg-aurora" aria-hidden="true">
      <span className="aurora-blob blob-1" />
      <span className="aurora-blob blob-2" />
      <span className="aurora-blob blob-3" />
      <span className="aurora-grid" />
    </div>
  )
}

/** 容器内局部极光（欢迎页 / 启动页），配合 isolation 使用。 */
export function AuroraScope() {
  return (
    <div className="vm-aurora" aria-hidden="true">
      <span className="aurora-blob blob-1" />
      <span className="aurora-blob blob-2" />
      <span className="aurora-blob blob-3" />
    </div>
  )
}

/** 少量静态星点，避免欢迎页同时运行数十个无限动画。 */
export function Sparkles({ count = 12, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`vm-sparkles ${className}`} aria-hidden="true">
      {Array.from({length: Math.min(count, 12)}, (_, i) => (
        <span
          key={i}
          className={i % 4 === 0 ? 'spark spark-accent' : 'spark'}
          style={{
            left: `${(i * 37 + 11) % 100}%`,
            top: `${(i * 23 + 7) % 100}%`
          }}
        />
      ))}
    </div>
  )
}

/** 整句一次淡入，减少首屏节点和逐字 filter 动画。 */
export function TextReveal({ text, className = '' }: { text: string; className?: string }) {
  return <span className={`vm-text-reveal ${className}`}>{text}</span>
}
