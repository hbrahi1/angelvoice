<script setup>
import Reminders from './components/Reminders.vue'
</script>

<template>
  <header>
    <img alt="Vue logo" class="logo" src="./assets/logo.png" width="125" height="125" />
    <h1 class="title">Olly</h1>
  </header>

  <main>
    <Reminders />
  </main>
</template>

<style scoped>
header {
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}

.title { font-size: 1.5rem; }

.logo {
  display: block;
  width: min(125px, 25vw);
  height: auto;
}

@media (min-width: 1024px) {
  header {
    padding-right: calc(var(--section-gap) / 2);
  }
}
</style>
