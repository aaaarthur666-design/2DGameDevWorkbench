import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '2D Game Dev Workbench · AI 游戏生产工作台',
  description: '通过网页与 Agent 对话驱动 2D 游戏生产能力。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
