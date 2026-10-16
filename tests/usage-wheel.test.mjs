import test from 'node:test';
import assert from 'node:assert/strict';
import { usageWheelDelta, attachUsageWheel } from '../ui/usage-wheel.mjs';
test('wheel conversion accelerates vertical wheels, normalizes units and preserves native horizontal / zoom',()=>{
 assert.equal(usageWheelDelta({deltaY:100,deltaX:0,deltaMode:0},300),180);
 assert.equal(usageWheelDelta({deltaY:1,deltaX:0,deltaMode:1},300),32.4);
 assert.equal(usageWheelDelta({deltaY:1,deltaX:0,deltaMode:2},300),540);
 assert.equal(usageWheelDelta({deltaY:100,deltaX:0,ctrlKey:true},300),0);
 assert.equal(usageWheelDelta({deltaY:10,deltaX:40},300),0);
});
test('wheel scroll clamps and does not trap edges or short lists',()=>{
 let listener,prevented=0;const strip={clientWidth:100,scrollWidth:300,scrollLeft:0,addEventListener(type,fn,options){assert.equal(type,'wheel');assert.equal(options.passive,false);listener=fn}};
 attachUsageWheel(strip);const fire=y=>listener({deltaY:y,deltaX:0,deltaMode:0,preventDefault(){prevented++}});
 fire(-20);assert.equal(prevented,0);fire(200);assert.equal(strip.scrollLeft,200);assert.equal(prevented,1);fire(10);assert.equal(prevented,1);fire(-20);assert.equal(strip.scrollLeft,164);
 strip.scrollWidth=100;fire(20);assert.equal(prevented,2);
});
