<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import DocsChat from './components/DocsChat.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <!-- The assistant is browser-only (WebGPU, fetch, retrieval index), so it
         renders client-side and never runs during static generation. -->
    <template #layout-bottom>
      <ClientOnly>
        <DocsChat />
      </ClientOnly>
    </template>
  </Layout>
</template>
