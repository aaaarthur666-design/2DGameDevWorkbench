import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '2D Game Dev Workbench · AI 游戏生产工作台',
  description: '供外部 Agent 客户端与网页控制台共同驱动的 2D 游戏生产工作台。',
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
