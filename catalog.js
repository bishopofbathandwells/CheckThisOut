// Fixed demonstration data, not live recommendations or verified listening matches.
export const catalog = [
['Jungle','Back On 74','#c48247'],['Little Simz','Gorilla','#855d85'],['Khruangbin','A Love International','#5b9586'],['L’Imperatrice','Vanille fraise','#b86054'],['Michael Kiwanuka','Floating Parade','#778b49'],
['SAULT','Wildfires','#756478'],['Parcels','Tieduprightnow','#538a91'],['Cleo Sol','When I’m in Your Arms','#b17a58'],['Men I Trust','Show Me How','#657aab'],['Yussef Dayes','Black Classical Music','#a18340'],
['The Marías','Run Your Mouth','#697a9e'],['Ezra Collective','God Gave Me Feet For Dancing','#ac694e'],['Nubiyan Twist','Lights Out','#8d6c9d'],['Jordan Rakei','Freedom','#4b897c'],['Olivia Dean','Dive','#a57653']
].map(([artist,title,color],i)=>({id:`demo-${i}`,artist,title,color}));
