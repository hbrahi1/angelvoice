<script setup>
import Reminders from './components/Reminders.vue'
</script>

<template>
  <header>
    <img alt="Vue logo" class="logo" src="./assets/logo.png" width="125" height="125" />
    <h1 class="title">{{ $t('title') }}</h1>
  </header>

  <main>
    <Reminders />
  </main>
</template>

<style scoped>
/* Force Light Theme - Override System Dark Mode */
* {
  color-scheme: light !important;
}

header {
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  justify-content: center;
  flex-wrap: wrap;
  padding: 2rem 1rem;
  background: #FFFFFF !important;
  color: #212121 !important;
  color-scheme: light !important;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.title {
  font-size: 2rem;
  font-weight: 400;
  font-family: 'Roboto', 'Segoe UI', system-ui, -apple-system, sans-serif;
  color: #1976D2 !important;
  letter-spacing: 0;
  margin: 0;
}

.logo {
  display: block;
  width: min(125px, 25vw);
  height: auto;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.logo:hover {
  transform: scale(1.05);
}

main {
  background: #FFFFFF !important;
  min-height: calc(100vh - 200px);
  color-scheme: light !important;
}



@media (min-width: 1024px) {
  header {
    padding: 2rem calc(var(--section-gap, 2rem) / 2);
  }
}
</style>
