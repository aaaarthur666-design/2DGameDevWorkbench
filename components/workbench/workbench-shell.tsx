'use client';
/* oxlint-disable next/no-html-link-for-pages -- Native navigation is saved and guarded by WorkbenchProvider. */
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  PersonStanding,
} from 'lucide-react';
import { useWorkbench } from './workbench-provider';

export function WorkbenchShell() {
  const { lines, setQueueOpen } = useWorkbench();
  return (
    <main className="wb-page wb-home">
      <div className="wb-eyebrow">ASSET PRODUCTION</div>
      <h1>开始制作游戏资产</h1>
      <p className="wb-intro">选择角色制作或交互物制作，也可从资产库选用已有素材。</p>
      <div className="wb-production-lines">
        {lines.map((line) => (
          <a
            className="wb-production-card"
            key={line.id}
            href={line.href}
            data-accent={line.accent}
          >
            <div className="wb-production-preview" aria-hidden="true">
              <span className="wb-preview-label">{line.eyebrow}</span>
              {line.id === 'player' ? (
                <div className="wb-frame-strip">
                  {[1, 2, 3].map((i) => (
                    <div className="wb-frame" key={i}>
                      <PersonStanding strokeWidth={1.6} />
                      <span>F.0{i}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="wb-map-preview">
                  <div className="wb-map-block">
                    <Box strokeWidth={1} />
                  </div>
                  <div className="wb-map-block">
                    <Box strokeWidth={1} />
                  </div>
                  <div className="wb-map-block">
                    <Box strokeWidth={1} />
                  </div>
                </div>
              )}
            </div>
            <div className="wb-production-copy">
              <div>
                <h2>{line.name}</h2>
                <span className="wb-entry-arrow">
                  <ArrowUpRight size={20} />
                </span>
              </div>
              <p>{line.description}</p>
              <div className="wb-card-flow">
                {line.summary.map((stage, i) => (
                  <span key={stage}>
                    {i > 0 && (
                      <span aria-hidden="true">
                        →
                      </span>
                    )}
                    {stage}
                  </span>
                ))}
              </div>
            </div>
          </a>
        ))}
      </div>
      <div className="wb-home-footer">
        <button className="wb-text-button" onClick={() => setQueueOpen(true)}>
          已有作品？继续上一次制作 <ArrowRight size={14} />
        </button>
        <span>每次专注一件资产</span>
      </div>
    </main>
  );
}
