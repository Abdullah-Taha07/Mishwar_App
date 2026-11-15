/* Account ownership is public metadata, never a credential or an authorization input. */
(()=>{
  let state={status:'unknown',accountKey:null,authenticated:false,verified:false,generation:0};
  let authSequence=0;
  const reads=new Set();
  const validKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const snapshot=()=>({...state});
  const emit=(name,detail={})=>window.dispatchEvent(new CustomEvent(name,{detail:{...snapshot(),...detail}}));
  function advance(){state.generation++;authSequence++;for(const controller of reads)controller.abort();reads.clear()}
  function reset(reason,previous){window.mishwarRiderVerified=false;emit('mishwar-account-reset',{reason,previousAccountKey:previous.accountKey,bootstrap:previous.status==='unknown'})}
  function invalidate(reason='session-changed'){
    const previous=snapshot();advance();state={status:'unknown',accountKey:null,authenticated:false,verified:false,generation:state.generation};
    reset(reason,previous);emit('mishwar-account-invalidated',{reason});
  }
  function isCurrent(ticket){return !!ticket&&ticket.generation===state.generation&&ticket.accountKey===state.accountKey&&state.status!=='transitioning'}
  function stale(){const error=Error('تغير الحساب أثناء الطلب.');error.name='AccountChangedError';return error}
  const api={
    snapshot,
    capture:()=>({generation:state.generation,accountKey:state.accountKey}),
    isCurrent,
    stale,
    ignored:error=>error?.name==='AccountChangedError'||error?.name==='AbortError',
    readController(){const controller=new AbortController();reads.add(controller);return {controller,release:()=>reads.delete(controller)}},
    beginAuthRead(){return {sequence:++authSequence,generation:state.generation}},
    isAuthReadCurrent:ticket=>!!ticket&&ticket.sequence===authSequence&&ticket.generation===state.generation&&state.status!=='transitioning',
    applyAuth(data,ticket){
      if(!api.isAuthReadCurrent(ticket))return false;
      const authenticated=data?.authenticated===true;
      if(authenticated&&!validKey(data.accountKey))throw Error('تعذر التحقق من هوية الحساب. أعد المحاولة.');
      const previous=snapshot(),accountKey=authenticated?data.accountKey:null,verified=authenticated&&data.phoneVerified!==false;
      const ownerChanged=previous.status!=='ready'||previous.accountKey!==accountKey||previous.authenticated!==authenticated;
      const verificationChanged=previous.verified!==verified;
      if(ownerChanged||verificationChanged)advance();
      state={status:'ready',accountKey,authenticated,verified,generation:state.generation};
      window.mishwarRiderVerified=verified;
      if(ownerChanged||previous.verified&&!verified)reset(ownerChanged?'account-changed':'verification-lost',previous);
      window.mishwarRiderVerified=verified;
      emit('mishwar-account-changed',{ownerChanged,verificationChanged,bootstrap:previous.status==='unknown'});
      return true;
    },
    notifyAuth(){emit('mishwar-auth-changed')},
    beginTransition(reason){const previous=snapshot();advance();state={status:'transitioning',accountKey:null,authenticated:false,verified:false,generation:state.generation};reset(reason,previous);return state.generation},
    isTransitionCurrent:generation=>state.status==='transitioning'&&generation===state.generation,
    finishTransition(generation){if(!api.isTransitionCurrent(generation))return false;state.status='unknown';return true},
    invalidate,
    checkResponseOwner(data,ticket){
      if(!isCurrent(ticket))throw stale();
      if(Object.prototype.hasOwnProperty.call(data||{},'accountKey')&&data.accountKey!==state.accountKey){invalidate('account-changed');throw stale()}
      if(data?.verified===false&&state.verified){invalidate('verification-lost');throw stale()}
      return true;
    },
    storageKey:name=>state.accountKey?name+':'+state.accountKey:null,
  };
  window.MishwarAccountContext=api;
  window.mishwarRiderVerified=false;
})();
