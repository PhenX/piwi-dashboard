<script setup lang="ts">
/**
 * `/settings` has no content of its own — it redirects to the first settings
 * page the current user can actually see.
 *
 * It used to render a "General settings" card whose entire body told you to
 * click something in the sidebar, which made the first click into Settings a
 * dead end. The target is computed from the same nav registry rather than
 * hardcoded, because "the first page" differs by role and build: an
 * unauthenticated-but-admin web instance lands on Account, a non-admin lands on
 * Account too, and the desktop build (single-user, auth off, account pages
 * hidden) lands on Notifications.
 */
const navItems = useSettingsNav();

const firstPage = computed(
  () => navItems.value.flat().find((item) => typeof item.to === 'string')?.to as string | undefined,
);

// `replace` so the Back button returns to wherever the user came from rather
// than bouncing them through this redirect again.
watchEffect(() => {
  if (firstPage.value) navigateTo(firstPage.value, { replace: true });
});
</script>

<template>
  <LoadingState text="Opening settings…" />
</template>
