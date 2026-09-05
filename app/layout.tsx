import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '2D Game Dev Workbench · 游戏资产生产工作台',
  description: '制作玩家动画、拼接地图和交互物，保存草稿并从制作记录继续。',
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
