import { defineConfig } from 'vitepress'
import { withPwa } from '@vite-pwa/vitepress'
import sidebar from './sidebar'

const isBuild = process.env.NODE_ENV === 'production'
const base = process.env.VP_BASE || (isBuild ? '/java-interview-wiki/' : '/')

export default withPwa(defineConfig({
  title: 'Java 知识手册',
  description: 'Java 知识手册：53 个专题，按基础、追问、深度层层递进',
  lang: 'zh-CN',
  base,
  lastUpdated: true,
  ignoreDeadLinks: [/^http:\/\/localhost/],
  head: [
    ['link', { rel: 'icon', href: `${base}icons/icon-192.png` }],
    ['link', { rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon-180.png` }],
    ['meta', { name: 'theme-color', content: '#1d4ed8' }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }],
    ['meta', { name: 'apple-mobile-web-app-title', content: 'Java 知识手册' }],
  ],

  themeConfig: {
    siteTitle: 'Java 知识手册',
    nav: [
      { text: '首页', link: '/' },
      { text: 'Java 基础', link: '/guide/t01' },
      { text: 'MySQL', link: '/guide/t19' },
      { text: 'Redis', link: '/guide/t23' },
      { text: '分布式', link: '/guide/t26' },
      { text: 'Java 8', link: '/guide/java8-lambda' },
    ],
    sidebar,
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除搜索',
            backButtonTitle: '关闭搜索',
            displayDetails: '显示详细列表',
            footer: {
              navigateText: '切换',
              selectText: '选择',
              closeText: '关闭',
              navigateUpKeyAriaLabel: '上箭头',
              navigateDownKeyAriaLabel: '下箭头',
              selectKeyAriaLabel: '回车键',
              closeKeyAriaLabel: 'Esc 键',
            },
          },
        },
      },
    },
    footer: {
      message: '内容由 PDF 提取整理，仅供学习参考',
      copyright: 'Copyright © hyw',
    },
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Java 知识手册',
      short_name: 'Java 手册',
      description: 'Java 知识手册：53 个专题，按基础、追问、深度层层递进',
      lang: 'zh-CN',
      theme_color: '#1d4ed8',
      background_color: '#0f172a',
      display: 'standalone',
      start_url: './',
      scope: './',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      cleanupOutdatedCaches: true,
    },
  },

  markdown: {
    lineNumbers: true,
    container: {
      tipLabel: '提示',
      infoLabel: '信息',
      warningLabel: '注意',
      dangerLabel: '危险',
      detailsLabel: '详情',
    },
  },
}))
