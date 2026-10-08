---
title: "Gradient Descent in the ALPS: Abstracted Low-Poly Stylization and Fabrication" 
date: 2026-08-01
tags: ["Low poly", "Score distillation sampling"]
author: ["Ruben Wiersma*", "Alexandre Binninger*", "Peizhuo Li", "Tanguy Magne", "Annika Oehri", "Aviv Segall", "Danielle Luterbacher", "Marcel Padilla", "Jing Ren", "Olga Sorkine-Hornung"]
description: "" 
summary: "The paper presents a method for generating fabricable 2D low-poly style images from a given input image by optimizing the mesh geometry, topology and a fixed color palette using score distillation sampling.
" 
cover:
    image: "alps.png"
    alt: ""
    relative: false
editPost:
    URL: "https://dl.acm.org/journal/tog"
    Text: "ACM Transactions on Graphics"

---

---

#####
 
![](2026-alps.png#center)

---

##### Abstract

The low-poly style is a popular genre of vector graphics that depicts objects and scenes as flat-shaded meshes of low polygon count, often with a limited palette. In this paper, we propose a method to generate 2D low-poly meshes to abstract images. While it has been possible to achieve this look with general-purpose image generators and vector-based diffusion models, the resulting images are not guaranteed to be valid polygonal meshes. A key problem is that polygons overlap or intersect and, in the case of pixel-based image generators, the shapes are often not polygons. Moreover, the colors are not guaranteed to be constrained to a fixed palette. Aside from aesthetic considerations, this has practical consequences: it complicates editing and fabricating the results. We solve this problem by representing an image as a 2D polygonal mesh and optimizing the topology, geometry and coloring of the mesh using score distillation sampling, while enforcing geometric constraints, such as manifoldness and bijectivity. This presents unique challenges due to the discrete nature of the topology, which we handle using a fine-to-coarse strategy based on mesh simplification. By also constraining the colors to a fixed palette, we are able to produce various fabrications such as mosaics, embroidery, crocheting, patchwork and stencils from the resulting vector images.

---

##### Download

+ [Paper](alps.pdf)
+ [Video](https://www.youtube.com/watch?v=UwjJlGLnLbg)
+ [Code and data](https://github.com/rubenwiersma/alps)
---

##### Citation

```BibTeX
@inproceedings{igl:ALPS:2026,
author = {Wiersma, Ruben and Binninger, Alexandre and Li, Peizhuo and Oehri, Annika and Segall, Aviv and Magne, Tanguy and Luterbacher, Danielle and Padilla, Marcel and Ren, Jing and Sorkine-Hornung, Olga},
title={Gradient Descent in the ALPS: Abstracted Low-Poly Stylization and Fabrication},
year = {2026},
isbn = {979-8-4007-2554-8/2026/07},
publisher = {Association for Computing Machinery},
address = {New York, NY, USA},
url = {https://doi.org/10.1145/3799902.3811050},
doi = {https://doi.org/10.1145/3799902.3811050},
booktitle = {SIGGRAPH Conference Papers '26},
location = {Los Angeles, CA, USA},
series = {SIGGRAPH Conference Papers '26}
}
```

---

<!-- ##### Related material

+ [Presentation slides](presentation2.pdf)
 -->
