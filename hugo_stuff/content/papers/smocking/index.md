---
title: "Digital 3D Smocking Design" 
date: 2023-09-13
tags: ["Smocking", "Embroidery", "Shape Deformation", "Graph Embedding"]
author: ["Jing Ren", "Aviv Segall", "Olga Sorkine-Hornung"]
description: "" 
summary: "The paper presents a method for digitally previewing a smocking pattern design by formulating smocking as a graph embedding and shape deformation problem.
" 
cover:
    image: "smocking.png"
    alt: ""
    relative: false
editPost:
    URL: "https://dl.acm.org/journal/tog"
    Text: "ACM Transactions on Graphics"

---

---

#####

![](smocking.png)

---

##### Abstract

We develop an optimization-based method to model smocking, a surface embroidery technique that provides decorative geometric texturing while maintaining stretch properties of the fabric. During smocking, multiple pairs of points on the fabric are stitched together, creating non-manifold geomet- ric features and visually pleasing textures. Designing smocking patterns is challenging, because the outcome of stitching is unpredictable: the final tex- ture is often revealed only when the whole smocking process is completed, necessitating painstaking physical fabrication and time consuming trial-and- error experimentation. This motivates us to seek a digital smocking design method. Straightforward attempts to compute smocked fabric geometry us- ing surface deformation or cloth simulation methods fail to produce realistic results, likely due to the intricate structure of the designs, the large number of contacts and high-curvature folds. We instead formulate smocking as a graph embedding and shape deformation problem. We extract a coarse graph representing the fabric and the stitching constraints, and then derive the graph structure of the smocked result. We solve for the 3D embedding of this graph, which in turn reliably guides the deformation of the high-resolution fabric mesh. Our optimization based method is simple, efficient, and flexible, which allows us to build an interactive system for smocking pattern explo- ration. To demonstrate the accuracy of our method, we compare our results to real fabrications on a large set of smocking patterns.

---

##### Download

+ [Paper](smocking_paper.pdf)
+ [Code and data](https://github.com/llorz/SmockingDesign)

---

##### Citation

```BibTeX
@article{10.1145/3631945,
author = {Ren, Jing and Segall, Aviv and Sorkine-Hornung, Olga},
title = {Digital 3D Smocking Design},
year = {2023},
publisher = {Association for Computing Machinery},
address = {New York, NY, USA},
issn = {0730-0301},
url = {https://doi.org/10.1145/3631945},
doi = {10.1145/3631945},
journal = {ACM Trans. Graph.},
month = {nov},
keywords = {Embroidery, Smocking, Graph Embedding, Shape Deformation}
}
```

---

<!-- ##### Related material

+ [Presentation slides](presentation2.pdf)
 -->
