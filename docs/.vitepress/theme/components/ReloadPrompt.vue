<script setup lang="ts">
import { ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

const needRefresh = ref(false)

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    needRefresh.value = true
  },
  onOfflineReady() {},
})

function close() {
  needRefresh.value = false
}

function refresh() {
  updateSW(true)
}
</script>

<template>
  <div v-if="needRefresh" class="pwa-toast" role="alert">
    <span class="pwa-message">发现新内容，刷新后生效</span>
    <button class="pwa-refresh" type="button" @click="refresh">刷新</button>
    <button class="pwa-close" type="button" aria-label="关闭" @click="close">✕</button>
  </div>
</template>

<style scoped>
.pwa-toast {
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px;
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  font-size: 14px;
}

.pwa-message {
  color: var(--vp-c-text-1);
}

.pwa-refresh {
  padding: 4px 14px;
  font-size: 13px;
  color: var(--vp-c-white);
  background: var(--vp-c-brand-1);
  border: none;
  border-radius: 14px;
  cursor: pointer;
}

.pwa-close {
  padding: 0 4px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
}
</style>
