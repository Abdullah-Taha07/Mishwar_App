import assert from 'node:assert/strict';
import {startJourneyServer} from './rider-journey-server.mjs';

// RDEV-002: receipt-only acceptance. Persisted rides are explicit synthetic
// fixtures, not a second claim to have tested the already accepted booking flow.
// The source rider gateway, shared Worker, sessions and isolated SQLite are real.
export async function startReceiptServer(options={}) {
  const nativeFetch=globalThis.fetch;
  const lab=await startJourneyServer(options);
  try {
    const original=await lab.resetFixture({returning:true,scenarioId:'RDEV-002-receipts'});
    const second={name:'راكب الإيصال الثاني',phone:'0500000092',email:'receipt-second@example.test',password:'receipt-offline-second-only-123'};
    const register=await nativeFetch(lab.origin+'/api/auth/register',{method:'POST',headers:{Origin:lab.origin,'Content-Type':'application/json'},body:JSON.stringify(second)});
    assert.equal(register.status,201,'Second synthetic account registers through the real gateway');
    const registered=await register.json();
    assert.equal(registered.authenticated,true);
    const db=lab.env.db;
    const accountB=db.prepare("SELECT * FROM public_accounts WHERE role='rider' AND phone=?").get('+966'+second.phone.slice(1));
    assert.ok(accountB);
    // Phone ownership itself is outside this receipt task. The first synthetic
    // rider was verified by the existing fake-SMS fixture; the second is marked
    // as a test-only verified fixture before the browser logs in normally.
    const at='2026-11-18T09:30:00.000Z';
    db.prepare("UPDATE public_accounts SET phone_verified_at=?,verification_method='receipt_fixture' WHERE actor=?").run(at,accountB.actor);
    db.prepare('INSERT OR IGNORE INTO rider_phone_accounts(phone,actor,verified_at) VALUES(?,?,?)').run(accountB.phone,accountB.actor,at);
    db.prepare('INSERT OR IGNORE INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').run('rider:'+accountB.actor,accountB.name,accountB.phone,accountB.email,at,at);
    const accountA=db.prepare("SELECT * FROM public_accounts WHERE role='rider' AND phone=?").get('+966'+original.credentials.phone.slice(1));
    assert.ok(accountA?.phone_verified_at);
    const captain=db.prepare('SELECT id FROM captain_applications LIMIT 1').get().id;
    const fixtures=[
      {id:'22222222-2222-4222-8222-222222222201',owner:accountA.actor,status:'completed',method:'cash',fare:4750,discount:250,pickup:'شارع الإيصال التجريبي — الرياض',destination:'وجهة الإيصال الأولى — حي الاختبار',createdAt:at,completedAt:'2026-11-18T09:42:00.000Z'},
      {id:'22222222-2222-4222-8222-222222222202',owner:accountA.actor,status:'completed',method:'card',fare:6800,discount:0,pickup:'انطلاق بطاقة تجريبي',destination:'وجهة بطاقة تجريبية',createdAt:'2026-11-17T18:10:00.000Z',completedAt:'2026-11-17T18:25:00.000Z'},
      {id:'22222222-2222-4222-8222-222222222203',owner:accountA.actor,status:'cancelled',method:'cash',fare:3500,discount:0,pickup:'انطلاق رحلة ملغاة',destination:'وجهة رحلة ملغاة',createdAt:'2026-11-16T09:00:00.000Z',completedAt:'2026-11-16T09:01:00.000Z'},
      {id:'33333333-3333-4333-8333-333333333301',owner:accountB.actor,status:'completed',method:'wallet',fare:5200,discount:700,pickup:'انطلاق الحساب الثاني فقط',destination:'وجهة الحساب الثاني فقط',createdAt:'2026-11-18T14:00:00.000Z',completedAt:'2026-11-18T14:20:00.000Z'},
    ];
    for(const t of fixtures){
      const pickup={name:t.pickup,lat:24.7136,lng:46.6753},destination={name:t.destination,lat:24.721,lng:46.684};
      const quote='quote-'+t.id;
      db.prepare('INSERT INTO ride_quotes(id,rider_id,pickup_json,destination_json,category,fare_halalas,discount_halalas,commission_bps,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run(quote,'rider:'+t.owner,JSON.stringify(pickup),JSON.stringify(destination),'economy',t.fare,t.discount,1000,'2030-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO trips(id,rider_id,driver_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(t.id,'rider:'+t.owner,captain,t.status,JSON.stringify(pickup),JSON.stringify(destination),t.fare,1000,t.status==='completed'?(t.method==='cash'?'cash_collected':'paid'):'pending',0,t.createdAt,t.completedAt);
      db.prepare('INSERT INTO trip_commerce(trip_id,quote_id,method,discount_halalas,cash_due_halalas) VALUES(?,?,?,?,?)').run(t.id,quote,t.method,t.discount,t.method==='cash'?t.fare-t.discount:0);
    }
    const counts=()=>({trips:db.prepare('SELECT COUNT(*) n FROM trips').get().n,receipts:db.prepare('SELECT COUNT(*) n FROM trip_receipts').get().n,settlements:db.prepare('SELECT COUNT(*) n FROM trip_settlements').get().n,walletEntries:db.prepare('SELECT COUNT(*) n FROM wallet_entries').get().n});
    return {...lab,fixtures,accounts:[original.credentials,second],counts,fixtureDisclosure:'Seeded synthetic persisted trips and second verified phone; real application/gateway/Worker, real login APIs, independent in-memory SQLite, no provider traffic.'};
  }catch(error){await lab.close();throw error}
}
