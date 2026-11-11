<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import ReloadPrompt from './components/ReloadPrompt.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout />
  <ReloadPrompt />
</template>
