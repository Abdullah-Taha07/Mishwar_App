import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const sandbox={window:{MishwarLang:{get:()=> 'en'}}};vm.createContext(sandbox);vm.runInContext(readFileSync(new URL('../public/i18n-catalog.js',import.meta.url),'utf8'),sandbox);
const english=sandbox.window.MishwarEnglish;
test('new account, notification, tracking and provider errors have explicit English messages',()=>{
  for(const source of ['تغيير الجوال وكلمة المرور','تعذر حفظ المكان على هذا الجهاز. لم يُحفظ التعديل.','إعدادات إشعارات الخلفية','انتهت مهلة تحديث المشوار. سنعيد المحاولة.','كلمة المرور الحالية غير صحيحة','مرجع الدفع لا يطابق المحاولة السابقة.']){
    const result=english.lookup(source);assert.ok(result);assert.doesNotMatch(result,/[\u0600-\u06ff]/);
  }
});
test('dynamic numeric messages keep their value and translate complete known sentences',()=>{
  assert.equal(english.lookup('إعادة الإرسال بعد ٣٠ ثانية'),'Resend in 30 seconds');
  assert.equal(english.lookup('تسعيرتي أقل من الحد الأدنى: ١٢٫٥٠ ريال'),'Your offered fare is below the minimum: 12.50 SAR');
  assert.equal(english.lookup('  ٤٫٥ من 5  '),'  4.5 out of 5  ');
});
test('unknown non-error text is not rewritten and user-provided captures remain intact',()=>{
  assert.equal(english.lookup('منزل أحمد في شارع الملك'),null);
  assert.equal(english.lookup('اختر اسم مستخدم خاص'),null);
  assert.equal(english.lookup('حياك أحمد'),'Welcome, أحمد');
  assert.equal(english.lookup('الحساب معلق: مراجعة مستندات أحمد'),'Account suspended: مراجعة مستندات أحمد');
});
test('generic fallback is explicit for unknown error containers and never discards native English errors',()=>{
  assert.equal(english.unknownError('خطأ عربي جديد'),'The request could not be completed. Please try again.');
  assert.equal(english.unknownError('Network request failed'),'Network request failed');
  assert.equal(english.locale(),'en-GB');
});

test('date formatting uses the selected language without replacing editable form values',()=>{
  const at='2026-11-16T09:30:00Z';assert.doesNotMatch(english.formatDate(at),/[\u0600-\u06ff]/);assert.match(english.formatDate(at),/2026/);
  sandbox.window.MishwarLang.get=()=> 'ar';assert.match(english.formatDate(at),/[\u0600-\u06ff]/);sandbox.window.MishwarLang.get=()=> 'en';assert.equal(english.formatDate('not a date'),'—');
});

test('compact help heading is translated before release to English mode',()=>{
 const screen=readFileSync(new URL('../public/screens.js',import.meta.url),'utf8');
 const match=screen.match(/class="feature-heading">([^<]+)<\/h3>/);
 assert.ok(match,'compact help heading must be present');
 assert.equal(match[1],'كيف نقدر نساعدك؟');
 assert.equal(english.lookup(match[1]),'How can we help you?');
});
