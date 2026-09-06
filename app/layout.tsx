import type { Metadata } from 'next';
import './globals.css';
import { workbenchBrand, workbenchTitle } from '@/lib/workbench/brand';

export const metadata: Metadata = {
  title: workbenchTitle,
  applicationName: workbenchBrand.name,
  icons: { icon: { url: workbenchBrand.icon, type: 'image/svg+xml' } },
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
