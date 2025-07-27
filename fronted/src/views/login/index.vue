<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NCard, NForm, NFormItem, NInput, NText } from 'naive-ui';
import { useMessage } from 'naive-ui';
import type { FormInst, FormRules } from 'naive-ui';
import { useRouter } from 'vue-router';

import { SvgIcon } from '@/components/common';
import { useAppStore, useAuthStore } from '@/store';
import { t } from '@/locales';
import { fetchRegisterAccount, fetchLoginAccount } from '@/api';

const appStore = useAppStore();
const authStore = useAuthStore();
const router = useRouter();
const message = useMessage();
interface loginForm {
  email: string;
  password: string;
}

// 具体逻辑
const isLogin = ref<boolean>(true);
// 切换登录/注册模式
const toggleMode = () => {
  isLogin.value = !isLogin.value;
  form.value = {
    email: '',
    password: '',
  }
}

// 表单数据相关
const formRef = ref<FormInst | null>(null);
const form = ref<loginForm>({
  email: '',
  password: '',
});

// 定义表单校验规则
const rules: FormRules = {
  email: { 
      required: true, 
      message: t('login.inputEmail'),
      trigger: ['input', 'blur'],
      validator:(_, value:string) => {
        const isValid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value);
        return isValid ? true : new Error(t('login.emailInvalid'));
      }
    },
  password: { 
    required: true, 
    message: t('login.inputPassword'),
    trigger: ['input', 'blur'], 
  }
};

// 表单提交处理
const handleSubmit = async () => {
  // 表单数据校验
  await formRef.value?.validate();
  // 登录情况
  if (isLogin.value) {
    const res:any = await fetchLoginAccount(form.value.email, form.value.password);
    if (res.code === '200') {
      // 登录成功
      message.success('登录成功');

      router.push('/chat');
    }else{
      // 登录失败
      message.error('登录失败');
    }
  }else{
    // 注册情况
    const res:any = await fetchRegisterAccount(form.value.email, form.value.password);
    if (res.code === '201') {
      // 注册成功
      isLogin.value = true;
      toggleMode();
      message.success('注册成功');
    }else{
      // 注册失败
      message.error('注册失败');
    }
  }
  
}
const isDark = ref<boolean>(false);
const locale = ref<'zh-CN' | 'en-US'>('zh-CN');

// 切换主题
const toggleTheme = () => {
    isDark.value = !isDark.value;
    const curTheme = isDark.value ? 'dark' : 'light';
    appStore.setTheme(curTheme);
}

// 切换语言
const toggleLocale = () => {
    locale.value = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
    appStore.setLanguage(locale.value);
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-neutral-900 px-4">
    <!-- 右上角的切换主题和语言的按钮  -->
    <div class="absolute top-4 right-4 flex space-x-4">
      <NButton class="text-xl" @click="toggleTheme">
        <SvgIcon :icon="isDark ? 'mdi:weather-night' : 'mdi:weather-sunny'" class="w-5 h-5" />
      </NButton>
      <NButton class="text-xl" @click="toggleLocale">
        <SvgIcon :icon="locale === 'zh-CN' ? 'mdi:translate' : 'mdi:earth'" class="w-5 h-5" />
      </NButton>
    </div>
    <!-- 登录/注册 卡片-->
    <div class="w-full max-w-md">
      <NCard>
        <h2 class="text-2xl font-semibold text-center mb-6">
          {{ isLogin ? t('login.login') : t('login.register') }}
        </h2>
        <NForm :model="form" :rules="rules" ref="formRef">、
          <NFormItem :label="t('login.email')" path="email">
            <NInput v-model:value="form.email" :placeholder="t('login.inputEmail')" />
          </NFormItem>
          <NFormItem :label="t('login.password')" path="password">  
            <NInput v-model:value="form.password" type="password" :placeholder="t('login.inputPassword')" />
          </NFormItem>
          <NFormItem>
            <NButton type="primary" @click="handleSubmit" block class="mt-4">
              {{ isLogin ? t('login.login') : t('login.register') }}
            </NButton>
          </NFormItem>
        </NForm>
        <div>
          <NText type="info" class="cursor-pointer" @click="toggleMode">
            {{ isLogin ? t('login.notRegisterYet') : t('login.alreadyHaveAccount') }}
          </NText>
        </div>
      </NCard>
    </div>
  </div>
</template>

<style scoped lang="scss"></style>